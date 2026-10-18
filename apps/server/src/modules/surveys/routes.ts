/**
 * 问卷管理路由（坞主专属）
 *
 *   GET    /api/owner/surveys                 列表（含答卷数、能否继续收）
 *   POST   /api/owner/surveys                 新建
 *   GET    /api/owner/surveys/:id             详情（含题目）
 *   PUT    /api/owner/surveys/:id             改标题/说明/开关/期限/名额/题目
 *   DELETE /api/owner/surveys/:id             删除（答卷一并删）
 *   POST   /api/owner/surveys/:id/rotate      换令牌（旧链接立刻失效）
 *   GET    /api/owner/surveys/:id/responses   答卷列表
 *   GET    /api/owner/surveys/:id/export.csv  导出 CSV
 */
import express from 'express';
import { requireOwner } from '../../middleware/auth.js';
import { ok } from '../../utils/response.js';
import {
  createSurvey,
  deleteSurvey,
  exportResponsesCsv,
  getSurveyDetail,
  listResponses,
  listSurveys,
  rotateSurveyToken,
  updateSurvey,
} from './service.js';

export const surveysOwnerRouter = express.Router();
surveysOwnerRouter.use(requireOwner);

surveysOwnerRouter.get('/', (_req, res) => {
  const items = listSurveys();
  ok(res, { items, total: items.length });
});

surveysOwnerRouter.post('/', (req, res) => {
  ok(res, createSurvey((req.body ?? {}) as Record<string, unknown>), '问卷已创建', 201);
});

/** 导出必须排在 /:id 之前也安全（多一段路径），但显式放前面更好读 */
surveysOwnerRouter.get('/:id/export.csv', (req, res) => {
  const { filename, csv } = exportResponsesCsv(req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  // 带 BOM：Excel 才认 UTF-8，否则中文全是乱码
  res.send('\uFEFF' + csv);
});

surveysOwnerRouter.get('/:id/responses', (req, res) => {
  const items = listResponses(req.params.id);
  ok(res, { items, total: items.length });
});

surveysOwnerRouter.post('/:id/rotate', (req, res) => {
  ok(res, rotateSurveyToken(req.params.id), '已换新链接，旧链接失效');
});

surveysOwnerRouter.get('/:id', (req, res) => {
  ok(res, getSurveyDetail(req.params.id));
});

surveysOwnerRouter.put('/:id', (req, res) => {
  ok(res, updateSurvey(req.params.id, (req.body ?? {}) as Record<string, unknown>), '已保存');
});

surveysOwnerRouter.delete('/:id', (req, res) => {
  ok(res, deleteSurvey(req.params.id), '问卷已删除');
});
