/**
 * ffmpeg / ffprobe 封装
 * 设计原则：**外部程序是可选依赖**。没有 ffmpeg 时不能影响上传与主流程，
 * 只损失"时长/分辨率/视频封面"这三项信息（图片缩略图回退为原图）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from './logger.js';
import { fileExists } from './paths.js';

const pexec = promisify(execFile);

export interface MediaMeta {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** 二进制可用性探测结果缓存（避免每次上传都试一次） */
const binaryCache = new Map<string, boolean>();

/** 探测外部程序是否存在且可执行 */
export async function hasBinary(cmd: string): Promise<boolean> {
  if (!cmd) return false;
  const cached = binaryCache.get(cmd);
  if (cached !== undefined) return cached;

  try {
    await pexec(cmd, ['-version'], { timeout: 8000, windowsHide: true });
    binaryCache.set(cmd, true);
    return true;
  } catch {
    binaryCache.set(cmd, false);
    logger.warn(`未找到可用的外部程序：${cmd}（相关功能将自动降级）`);
    return false;
  }
}

/** 供测试或配置变更后重置缓存 */
export function resetBinaryCache(): void {
  binaryCache.clear();
}

/** 读取媒体元信息；失败或未安装 ffprobe 时返回 null（调用方自行降级） */
export async function probeMedia(filePath: string): Promise<MediaMeta | null> {
  if (!config.media.enabled) return null;
  if (!(await hasBinary(config.media.ffprobePath))) return null;

  try {
    const { stdout } = await pexec(
      config.media.ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 60_000, windowsHide: true },
    );

    const info = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        duration?: string;
      }>;
    };

    const streams = info.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');

    let durationMs: number | null = null;
    const rawDuration = info.format?.duration ?? video?.duration ?? audio?.duration;
    if (rawDuration !== undefined) {
      const sec = Number(rawDuration);
      if (Number.isFinite(sec) && sec >= 0) durationMs = Math.round(sec * 1000);
    }

    return {
      durationMs,
      width: video?.width ?? null,
      height: video?.height ?? null,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
    };
  } catch (err) {
    logger.warn('ffprobe 读取媒体信息失败（已降级）', {
      file: filePath,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * 生成缩略图（视频取第 atSeconds 秒的一帧；图片按比例缩放，不 seek）。
 * 返回是否成功；失败时调用方对图片可回退为原图，对视频则无缩略图。
 *
 * 注意 atSeconds：
 *  - 视频：传秒数，用于避开片头黑场；
 *  - 静图：必须传 null（或 0）。对静图下 `-ss N`（N>0）时 ffmpeg 会**退出码 0 但不产出任何帧**，
 *    若只信退出码就会把 thumb_path 写成不存在的文件，前端 /media/thumbs/* 直接 404。
 */
export async function makeThumbnail(
  input: string,
  output: string,
  opts: { atSeconds?: number | null; width?: number } = {},
): Promise<boolean> {
  if (!config.media.enabled) return false;
  if (!(await hasBinary(config.media.ffmpegPath))) return false;

  const at = opts.atSeconds ?? null;
  const width = opts.width ?? 720;

  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (at !== null && at > 0) args.push('-ss', String(at));
  args.push(
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:-2:force_original_aspect_ratio=decrease`,
    '-q:v',
    '4',
    output,
  );

  try {
    await pexec(config.media.ffmpegPath, args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
    // 退出码 0 不等于有产物：这里自己确认文件真的写出来了
    if (!fileExists(output)) {
      logger.warn('生成缩略图未产出文件（已降级）', { input, output });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('生成缩略图失败（已降级）', { input, error: (err as Error).message });
    return false;
  }
}
