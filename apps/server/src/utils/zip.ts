/**
 * 极简 ZIP 打包（零依赖，流式）
 *
 * 用途：文库条目「下载所有文件」——把一篇文稿绑定的全部文件打成一个 zip 下发给访客。
 * 设计取舍：
 *  1. **不压缩**（method = 0 STORE）：里面多半是 jpg/mp4/mp3 这类已经压过的二进制，
 *     再压一遍既费 CPU 又几乎不省体积；STORE 还能一边读一边写，**几十 GB 的视频也不会爆内存**。
 *  2. **用数据描述符**（general purpose flag bit 3）：先写头、再流式写数据、最后补 CRC 与长度，
 *     这样每个文件只读一遍（否则要先全读一遍算 CRC）。
 *  3. 文件名按 UTF-8 写并置 EFS 标记（bit 11），中文名在 Windows/macOS 解压都不乱码。
 *  4. 不实现 ZIP64：单文件或总大小超过 4 GiB 时直接报错，而不是吐一个坏包。
 */
import fs from 'node:fs';
import type { Response } from 'express';

export interface ZipEntry {
  /** zip 内的文件名（可含中文） */
  name: string;
  /** 磁盘绝对路径 */
  absPath: string;
  /** 字节数（来自数据库，用于提前判断是否超限） */
  size: number;
  mtime?: Date;
}

const ZIP64_LIMIT = 0xffffffff; // 4 GiB - 1

/** CRC32（增量式：初值 0xffffffff，结束时取反） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, buf: Buffer): number {
  let c = crc;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

/** Date → DOS 日期/时间（zip 头里用的老格式） */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** 写响应并处理背压，避免大文件把内存顶爆 */
function write(res: Response, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    res.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

interface CentralRecord {
  nameBuf: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/**
 * 把 entries 打包成 zip 流式写入 res。
 * 调用方负责先设好 Content-Type / Content-Disposition 头。
 */
export async function streamZip(res: Response, entries: ZipEntry[]): Promise<void> {
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (entries.some((e) => e.size > ZIP64_LIMIT) || total > ZIP64_LIMIT) {
    throw Object.assign(new Error('打包内容超过 4 GiB，超出内置打包器上限，请分批下载'), { status: 413 });
  }

  const central: CentralRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const entryOffset = offset;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosDateTime(entry.mtime ?? new Date());
    const flags = 0x0008 | 0x0800; // 数据描述符 + UTF-8 文件名

    // ---- 本地文件头（crc/长度先写 0，末尾用数据描述符补）
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // method = store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(0, 14); // crc
    local.writeUInt32LE(0, 18); // compressed size
    local.writeUInt32LE(0, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    await write(res, local);
    await write(res, nameBuf);

    // ---- 数据（流式，边读边算 CRC）
    let crc = 0xffffffff;
    let written = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(entry.absPath);
      let pending = Promise.resolve();
      stream.on('data', (chunk) => {
        const buf = chunk as Buffer;
        crc = crc32Update(crc, buf);
        written += buf.length;
        stream.pause();
        pending = pending.then(
          () => write(res, buf).then(() => {
            stream.resume();
          }),
          reject,
        );
      });
      stream.on('error', reject);
      stream.on('end', () => pending.then(resolve, reject));
    });
    const finalCrc = (crc ^ 0xffffffff) >>> 0;

    // ---- 数据描述符
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(finalCrc, 4);
    descriptor.writeUInt32LE(written, 8);
    descriptor.writeUInt32LE(written, 12);
    await write(res, descriptor);

    offset = entryOffset + local.length + nameBuf.length + written + descriptor.length;
    central.push({ nameBuf, crc: finalCrc, size: written, offset: entryOffset, time, date });
  }

  // ---- 中央目录
  const centralStart = offset;
  for (const rec of central) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // version made by
    head.writeUInt16LE(20, 6); // version needed
    head.writeUInt16LE(0x0008 | 0x0800, 8);
    head.writeUInt16LE(0, 10); // method
    head.writeUInt16LE(rec.time, 12);
    head.writeUInt16LE(rec.date, 14);
    head.writeUInt32LE(rec.crc, 16);
    head.writeUInt32LE(rec.size, 20);
    head.writeUInt32LE(rec.size, 24);
    head.writeUInt16LE(rec.nameBuf.length, 28);
    head.writeUInt16LE(0, 30); // extra
    head.writeUInt16LE(0, 32); // comment
    head.writeUInt16LE(0, 34); // disk number
    head.writeUInt16LE(0, 36); // internal attrs
    head.writeUInt32LE(0, 38); // external attrs
    head.writeUInt32LE(rec.offset, 42);
    await write(res, head);
    await write(res, rec.nameBuf);
    offset += head.length + rec.nameBuf.length;
  }

  // ---- 中央目录结束记录
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  await write(res, eocd);
}
