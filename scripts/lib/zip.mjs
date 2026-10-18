/**
 * 极简 ZIP 写入器（零依赖，纯 Node）
 *
 * 为什么不用系统自带命令：
 *   Windows 的 `Compress-Archive` 会用系统代码页写文件名，中文名（docs/架构设计.md）
 *   在压缩包里会变成乱码，到了 Linux 上文件名就废了。
 *   这里手写 ZIP 结构，并设置「UTF-8 文件名」标志位（general purpose bit 11），
 *   任何现代解压工具（unzip / 7-Zip / Windows 资源管理器 / bsdtar）都能正确还原。
 *
 * 支持：目录递归、store/deflate 自动择优、CRC32、Unix 权限位（.sh 保留 0755）。
 * 不支持：ZIP64（>4GB 或 >65535 个文件）—— 本项目远达不到，真到了再换。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS 时间/日期格式 */
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

function collectFiles(rootDir) {
  const out = [];
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push({ abs, rel });
    }
  };
  walk(rootDir, '');
  return out;
}

/**
 * 把 rootDir 下的内容打包成 zipPath。
 * 包内路径 = 相对 rootDir 的路径，所以想让压缩包里有 cangjingwu/ 这一层，
 * 就把 rootDir 传成它的**父目录**（例如 .../stage，其下只有 cangjingwu/）。
 */
export function writeZip(zipPath, rootDir) {
  const files = collectFiles(rootDir);
  const { time, date } = dosDateTime();

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { abs, rel } of files) {
    const data = fs.readFileSync(abs);
    const crc = crc32(data);
    const nameBuf = Buffer.from(rel, 'utf8');
    const isScript = rel.endsWith('.sh');

    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const FLAG_UTF8 = 0x0800;
    const unixMode = isScript ? 0o100755 : 0o100644;

    // ---- 本地文件头 ----
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 需要的版本 2.0
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, payload);

    // ---- 中央目录项 ----
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix(3) + 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(FLAG_UTF8, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE((unixMode << 16) >>> 0, 38); // external attrs = unix 权限
    cd.writeUInt32LE(offset, 42);
    centralParts.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(zipPath, Buffer.concat([...localParts, central, eocd]));
  return { entries: files.length, bytes: fs.statSync(zipPath).size };
}
