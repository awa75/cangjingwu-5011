/**
 * Express 应用装配
 * 中间件顺序很重要：安全头 → 跨域 → 解析体 → 访问日志 → 业务路由 → 静态前端 → 404 → 错误处理
 *
 * 新站相对旧站的挂载变化：/api/admin/*、/api/ai、/api/me、/api/credits、/api/lottery、
 * /api/internal、/api/tasks、/api/worker、/api/music、/api/media（作品集展示项）全部拆除，
 * 坞主那部分收敛成一个 /api/owner。
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { ok } from './utils/response.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLog.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/routes.js';
import { filesRouter } from './modules/files/routes.js';
import { mediaRouter } from './modules/files/serve.js';
import { previewPublicRouter } from './modules/files/preview.js';
import { collectionsRouter } from './modules/collections/routes.js';
import { documentsRouter } from './modules/documents/routes.js';
import { sharesRouter } from './modules/shares/routes.js';
import { sharePublicRouter } from './modules/shares/public.js';
import { publicRouter } from './modules/public/routes.js';
import { ownerRouter } from './modules/owner/routes.js';
import { membersOwnerRouter } from './modules/members/routes.js';
import { surveysOwnerRouter } from './modules/surveys/routes.js';
import { surveyPublicRouter } from './modules/surveys/public.js';

export function createApp(): express.Express {
  const app = express();

  // 部署在 Nginx 之后，需要信任代理头以拿到真实 IP（限流依赖）
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // 安全响应头；CSP 交给前端构建或 Nginx 层，这里不写死以免拦住静态资源
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 跨域：仅开发期需要（生产前端与后端同源）
  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: config.corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
      }),
    );
    logger.info(`已启用跨域白名单：${config.corsOrigins.join(', ')}`);
  }

  // 请求体解析：上传走 multipart 不受此限制
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(requestLogger);

  // ---------------------------------------------------------------- 健康检查
  app.get('/api/health', (_req, res) => {
    ok(res, {
      status: 'up',
      time: new Date().toISOString(),
      env: config.env,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
    });
  });

  // ---------------------------------------------------------------- 业务路由
  app.use('/api/auth', authRouter);
  app.use('/api/files', filesRouter);
  // 预览票直链：只认票、不认登录头，给 <img>/<video> 用（见 modules/files/preview.ts）
  app.use('/api/preview', previewPublicRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/shares', sharesRouter);
  // 坞主专属：概览统计 / 站点文案 / 邀请码 / 会员
  app.use('/api/owner', ownerRouter);
  app.use('/api/owner', membersOwnerRouter);
  // 问卷管理（坞主）—— 填答入口在下面 /api/q，免登录
  app.use('/api/owner/surveys', surveysOwnerRouter);
  // 公开只读（免登录）
  app.use('/api/public', publicRouter);
  // 问卷填答（免登录）：凭 token，站内无任何入口
  app.use('/api/q', surveyPublicRouter);
  // 分享访问（免登录）：注意放在 /api/shares 之后，路径段不冲突
  app.use('/api/s', sharePublicRouter);
  // 媒体出图出片（带收录与可见性校验）
  app.use('/media', mediaRouter);

  // ---------------------------------------------------------------- 静态前端
  const webDist = config.paths.webDist;
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1h',
        // HTML 一律走协商缓存：index.html 没有内容哈希，缓存 1 小时会让
        // 「重新构建了但浏览器还在放旧版」。带哈希的 /assets 仍按 1 小时强缓存。
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        },
      }),
    );
    // SPA 兜底：非 /api、非 /media 的 GET 一律交给前端路由
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
      res.sendFile(path.join(webDist, 'index.html'), { headers: { 'Cache-Control': 'no-cache, must-revalidate' } });
    });
    logger.info(`前端产物已托管：${webDist}`);
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain; charset=utf-8')
        .send(
          '藏经坞 后端已就绪。\n' +
            '前端尚未构建（apps/web/dist 不存在）。\n' +
            `健康检查：${config.publicBaseUrl}/api/health\n`,
        );
    });
    logger.info('未发现前端构建产物，仅提供 API 服务');
  }

  // ---------------------------------------------------------------- 兜底
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
