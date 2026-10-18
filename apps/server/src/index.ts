/**
 * 服务入口：配置校验 → 目录准备 → 迁移 → 初始化 → 启动 HTTP → 启动 janitor → 优雅退出
 */
import { assertConfig, config, describeConfig } from './config.js';
import { closeDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';
import { startJanitor } from './janitor.js';
import { promoteApprovedTextFiles } from './modules/files/promote.js';
import { logError, logger } from './utils/logger.js';
import { ensureStorageDirs } from './utils/paths.js';

function banner(): void {
  logger.info('══════════════════════════════════════════════════');
  logger.info(`  ${config.siteName}`);
  logger.info('  ZSR·DCM 协议养护计划（2026–2030）· 后端服务');
  logger.info('══════════════════════════════════════════════════');
  for (const line of describeConfig()) logger.info(`  ${line}`);
}

function main(): void {
  assertConfig();
  banner();

  ensureStorageDirs();
  migrate();
  seed();

  // 幂等回填：把「在升格逻辑存在之前就被收录」的文本投稿补成文库文稿
  const backfilled = promoteApprovedTextFiles();
  if (backfilled > 0) logger.info(`已补升格 ${backfilled} 个投稿为文库文稿`);

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info(`服务已启动：${config.publicBaseUrl}  (监听 ${config.host}:${config.port})`);
    logger.info(`健康检查：${config.publicBaseUrl}/api/health`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`端口 ${config.port} 已被占用，请修改 .env 中的 PORT 或先关闭占用进程`);
    } else {
      logError('HTTP 服务错误', err);
    }
    process.exit(1);
  });

  const janitor = startJanitor();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，正在优雅退出…`);

    clearInterval(janitor);
    server.close(() => {
      try {
        closeDb();
        logger.info('数据库已关闭，进程退出');
      } catch (err) {
        logError('关闭数据库失败', err);
      }
      process.exit(0);
    });

    // 兜底：10 秒内没关完就强制退出
    setTimeout(() => {
      logger.warn('优雅退出超时，强制结束进程');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logError('未处理的 Promise 拒绝', reason));
  process.on('uncaughtException', (err) => {
    logError('未捕获的异常', err);
    shutdown('uncaughtException');
  });
}

main();
