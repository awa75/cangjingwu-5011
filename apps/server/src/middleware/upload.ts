/**
 * 上传接收（multer）
 * 安全要点：
 *  1. 扩展名白名单决定文件大类与落盘目录，未知扩展名一律拒绝；
 *  2. 落盘文件名由服务端生成（前缀 + 随机），绝不使用用户提供的名字拼路径；
 *  3. 原始文件名只存数据库，仅用于展示与下载时设置文件名。
 */
import multer from 'multer';
import type { FileKind } from '@cangjingwu/shared';
import { config } from '../config.js';
import { extOf, uploadDirFor } from '../utils/paths.js';
import { newId } from '../utils/ids.js';
import { ApiError } from '../utils/response.js';

/** 允许的扩展名 → 文件大类（不在表内的一律拒绝；刻意不含 svg，避免内联脚本风险） */
export const EXT_KIND: Record<string, FileKind> = {
  // 图片
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  avif: 'image',
  heic: 'image',
  tif: 'image',
  tiff: 'image',
  // 视频
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  avi: 'video',
  m4v: 'video',
  flv: 'video',
  wmv: 'video',
  mpg: 'video',
  mpeg: 'video',
  // 音频
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wma: 'audio',
  amr: 'audio',
  aiff: 'audio',
  // 文档
  md: 'doc',
  markdown: 'doc',
  txt: 'doc',
  pdf: 'doc',
  json: 'doc',
  csv: 'doc',
  // 其它归档
  zip: 'other',
  '7z': 'other',
  rar: 'other',
  gz: 'other',
  tar: 'other',
};

export const ALLOWED_EXTENSIONS = Object.keys(EXT_KIND).sort();

/** 依据扩展名判定大类；未知扩展名返回 null */
export function kindOf(filename: string): FileKind | null {
  return EXT_KIND[extOf(filename)] ?? null;
}

const storage = multer.diskStorage({
  destination(_req, file, cb) {
    const kind = kindOf(file.originalname);
    if (!kind) {
      cb(ApiError.badRequest(`不支持的文件类型：${file.originalname}`), '');
      return;
    }
    cb(null, uploadDirFor(kind));
  },
  filename(_req, file, cb) {
    const ext = extOf(file.originalname);
    cb(null, `${newId('f')}${ext ? `.${ext}` : ''}`);
  },
});

/**
 * 接收任意字段名的文件（兼容 file / files / 自定义字段），便于 curl 与前端各种写法。
 * 使用后：req.files 为 Express.Multer.File[]
 *
 * defParamCharset: busboy 默认按 latin1 解码 multipart 里的 filename，
 * 中文文件名（如「港口黄昏.jpg」）会被存成「æ¸¯å£é»æ.jpg」这种乱码。
 * multer 2.x 会把它透传给 busboy，这里显式要求 UTF-8。
 * （@types/multer 尚未收录该字段，故用交叉类型声明。）
 */
type UploadOptions = multer.Options & { defParamCharset?: string };

const uploadOptions: UploadOptions = {
  storage,
  defParamCharset: 'utf8',
  limits: {
    fileSize: config.upload.maxBytes,
    files: config.upload.maxFiles,
    fields: 20,
  },
  fileFilter(_req, file, cb) {
    if (!kindOf(file.originalname)) {
      cb(
        ApiError.badRequest(
          `不支持的文件类型「${extOf(file.originalname) || '无扩展名'}」。允许：${ALLOWED_EXTENSIONS.join(', ')}`,
        ),
      );
      return;
    }
    cb(null, true);
  },
};

export const uploadAny = multer(uploadOptions).any();
