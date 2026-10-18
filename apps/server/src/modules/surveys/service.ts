/**
 * 问卷服务
 *
 * 设计要点：
 *   1. 问卷不进文库，也不在任何公开列表里 —— 只有坞主在 /edit 看得到，
 *      作答者必须持有 /q/<token> 链接。
 *   2. 作答者**不需要账号**（要登录就失去「把链接发过去」的意义），
 *      所以「同一浏览器一份」用 cookie 派生的哈希实现，不落明文 IP。
 *   3. 题库一旦有人作答，**只允许改字段、不允许增删题目** ——
 *      否则老答卷的 question_id 会指向不存在的题，统计直接错位。
 */
import type {
  PublicSurvey,
  SurveyAnswerValue,
  SurveyDetail,
  SurveyItem,
  SurveyQuestion,
  SurveyQuestionKind,
  SurveyResponseItem,
  SurveyStatus,
} from '@cangjingwu/shared';
import { SURVEY_QUESTION_KINDS } from '@cangjingwu/shared';
import { all, get, run, tx } from '../../db/index.js';
import { ApiError } from '../../utils/response.js';
import { newId, newToken, nowIso } from '../../utils/ids.js';

/* ------------------------------------------------------------------ 行类型 */

interface SurveyRow {
  id: string;
  token: string;
  title: string;
  description_md: string;
  status: string;
  expires_at: string | null;
  max_responses: number | null;
  one_per_visitor: number;
  created_at: string;
  updated_at: string;
}

interface QuestionRow {
  id: string;
  survey_id: string;
  sort_order: number;
  kind: string;
  title: string;
  hint: string;
  required: number;
  options_json: string;
  max_rating: number;
  created_at: string;
}

interface ResponseRow {
  id: string;
  survey_id: string;
  submitted_at: string;
  visitor_hash: string;
  ua: string;
}

interface AnswerRow {
  id: string;
  response_id: string;
  question_id: string;
  value_json: string;
}

/* ------------------------------------------------------------------ 工具 */

const MAX_QUESTIONS = 50;
const MAX_TITLE = 200;
const MAX_DESC = 20000;
const MAX_TEXT_ANSWER = 5000;
const MAX_OPTIONS = 50;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isQuestionKind(v: unknown): v is SurveyQuestionKind {
  return typeof v === 'string' && (SURVEY_QUESTION_KINDS as string[]).includes(v);
}

/** 问卷此刻还能不能收答卷；不能则给出人话原因 */
export function surveyState(row: SurveyRow, responseCount: number): { accepting: boolean; closedReason: string } {
  if (row.status !== 'open') return { accepting: false, closedReason: '这份问卷已关闭' };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { accepting: false, closedReason: '这份问卷已过期' };
  }
  if (row.max_responses !== null && responseCount >= row.max_responses) {
    return { accepting: false, closedReason: '名额已满，感谢参与' };
  }
  return { accepting: true, closedReason: '' };
}

function toQuestion(row: QuestionRow): SurveyQuestion {
  return {
    id: row.id,
    kind: row.kind as SurveyQuestionKind,
    title: row.title,
    hint: row.hint,
    required: row.required === 1,
    options: parseJson<string[]>(row.options_json, []),
    maxRating: row.max_rating,
    sortOrder: row.sort_order,
  };
}

function countResponses(surveyId: string): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM survey_responses WHERE survey_id = ?', surveyId)?.c ?? 0;
}

function countQuestions(surveyId: string): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM survey_questions WHERE survey_id = ?', surveyId)?.c ?? 0;
}

function toSurveyItem(row: SurveyRow, questions: number, responses: number): SurveyItem {
  const state = surveyState(row, responses);
  return {
    id: row.id,
    token: row.token,
    path: `/q/${row.token}`,
    title: row.title,
    descriptionMd: row.description_md,
    status: row.status as SurveyStatus,
    expiresAt: row.expires_at,
    maxResponses: row.max_responses,
    onePerVisitor: row.one_per_visitor === 1,
    questionCount: questions,
    responseCount: responses,
    accepting: state.accepting,
    closedReason: state.closedReason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireSurveyRow(id: string): SurveyRow {
  const row = get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', id);
  if (!row) throw ApiError.notFound('问卷不存在');
  return row;
}

function findSurveyByToken(token: string): SurveyRow | undefined {
  return get<SurveyRow>('SELECT * FROM surveys WHERE token = ?', token);
}

function listQuestionRows(surveyId: string): QuestionRow[] {
  return all<QuestionRow>(
    'SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order ASC',
    surveyId,
  );
}

/* ------------------------------------------------------------------ 题目校验 */

interface NormalizedQuestion {
  /** 已存在的题会带回 id；新题没有 */
  id: string | null;
  kind: SurveyQuestionKind;
  title: string;
  hint: string;
  required: boolean;
  options: string[];
  maxRating: number;
}

function normalizeQuestion(input: Record<string, unknown>, index: number): NormalizedQuestion {
  const where = `第 ${index + 1} 题`;
  const kind = input.kind;
  if (!isQuestionKind(kind)) throw ApiError.badRequest(`${where}的类型不对（single/multiple/text/paragraph/rating）`);

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw ApiError.badRequest(`${where}缺少题干`);
  if (title.length > MAX_TITLE) throw ApiError.badRequest(`${where}的题干超过 ${MAX_TITLE} 字`);

  const hint = typeof input.hint === 'string' ? input.hint.trim() : '';
  if (hint.length > MAX_TITLE) throw ApiError.badRequest(`${where}的提示超过 ${MAX_TITLE} 字`);

  const required = input.required === true;

  let options: string[] = [];
  if (kind === 'single' || kind === 'multiple') {
    const raw = Array.isArray(input.options) ? input.options : [];
    const seen = new Set<string>();
    for (const o of raw) {
      if (typeof o !== 'string') continue;
      const t = o.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      options.push(t);
      if (options.length > MAX_OPTIONS) throw ApiError.badRequest(`${where}的选项超过 ${MAX_OPTIONS} 个`);
    }
    if (options.length < 2) throw ApiError.badRequest(`${where}至少要有 2 个选项`);
  }

  let maxRating = 5;
  if (kind === 'rating') {
    const raw = Number(input.maxRating ?? 5);
    if (!Number.isInteger(raw) || raw < 2 || raw > 10) throw ApiError.badRequest(`${where}的满分只能是 2..10`);
    maxRating = raw;
  }

  const id = typeof input.id === 'string' && input.id.startsWith('sq_') ? input.id : null;
  return { id, kind, title, hint, required, options, maxRating };
}

function normalizeQuestions(input: unknown): NormalizedQuestion[] {
  if (!Array.isArray(input) || input.length === 0) throw ApiError.badRequest('至少要有一道题');
  if (input.length > MAX_QUESTIONS) throw ApiError.badRequest(`最多 ${MAX_QUESTIONS} 道题`);
  return input.map((q, i) => normalizeQuestion((q ?? {}) as Record<string, unknown>, i));
}

function insertQuestions(surveyId: string, questions: NormalizedQuestion[]): void {
  const now = nowIso();
  questions.forEach((q, i) => {
    run(
      `INSERT INTO survey_questions
        (id, survey_id, sort_order, kind, title, hint, required, options_json, max_rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('sq'),
      surveyId,
      i,
      q.kind,
      q.title,
      q.hint,
      q.required ? 1 : 0,
      JSON.stringify(q.options),
      q.maxRating,
      now,
    );
  });
}

/* ------------------------------------------------------------------ 坞主：读写 */

export function listSurveys(): SurveyItem[] {
  const rows = all<SurveyRow & { question_count: number; response_count: number }>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM survey_questions q WHERE q.survey_id = s.id) AS question_count,
            (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count
       FROM surveys s
      ORDER BY s.created_at DESC`,
  );
  return rows.map((r) => toSurveyItem(r, r.question_count, r.response_count));
}

export function getSurveyDetail(id: string): SurveyDetail {
  const row = requireSurveyRow(id);
  const questions = listQuestionRows(id).map(toQuestion);
  return { ...toSurveyItem(row, questions.length, countResponses(id)), questions };
}

export function createSurvey(input: Record<string, unknown>): SurveyDetail {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw ApiError.badRequest('请给问卷起个标题');
  if (title.length > MAX_TITLE) throw ApiError.badRequest(`标题超过 ${MAX_TITLE} 字`);

  const descriptionMd = typeof input.descriptionMd === 'string' ? input.descriptionMd : '';
  if (descriptionMd.length > MAX_DESC) throw ApiError.badRequest('说明太长');

  const questions = normalizeQuestions(input.questions);
  const id = newId('sv');
  const now = nowIso();
  const expiresAt = typeof input.expiresAt === 'string' && input.expiresAt ? input.expiresAt : null;
  const maxResponses =
    input.maxResponses === null || input.maxResponses === undefined || input.maxResponses === ''
      ? null
      : Math.max(1, Number(input.maxResponses) || 1);

  tx(() => {
    run(
      `INSERT INTO surveys
        (id, token, title, description_md, status, expires_at, max_responses, one_per_visitor, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      id,
      newToken(),
      title,
      descriptionMd,
      expiresAt,
      maxResponses,
      input.onePerVisitor === false ? 0 : 1,
      now,
      now,
    );
    insertQuestions(id, questions);
  });

  return getSurveyDetail(id);
}

export function updateSurvey(id: string, input: Record<string, unknown>): SurveyDetail {
  const row = requireSurveyRow(id);
  const patch: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw ApiError.badRequest('标题不能为空');
    if (title.length > MAX_TITLE) throw ApiError.badRequest(`标题超过 ${MAX_TITLE} 字`);
    patch.title = title;
  }
  if (input.descriptionMd !== undefined) {
    const desc = typeof input.descriptionMd === 'string' ? input.descriptionMd : '';
    if (desc.length > MAX_DESC) throw ApiError.badRequest('说明太长');
    patch.description_md = desc;
  }
  if (input.status !== undefined) {
    if (input.status !== 'open' && input.status !== 'closed') throw ApiError.badRequest('状态只能是 open/closed');
    patch.status = input.status;
  }
  if (input.expiresAt !== undefined) {
    patch.expires_at = typeof input.expiresAt === 'string' && input.expiresAt ? input.expiresAt : null;
  }
  if (input.maxResponses !== undefined) {
    patch.max_responses =
      input.maxResponses === null || input.maxResponses === ''
        ? null
        : Math.max(1, Number(input.maxResponses) || 1);
  }
  if (input.onePerVisitor !== undefined) {
    patch.one_per_visitor = input.onePerVisitor === false ? 0 : 1;
  }

  const questionsInput = input.questions;
  const responses = countResponses(id);

  tx(() => {
    if (questionsInput !== undefined) {
      const incoming = normalizeQuestions(questionsInput);
      if (responses > 0) {
        // 有答卷：只允许改字段，题目集合必须一模一样
        // 注意 incomingIds 会滤掉「没有 id 的新题」，所以必须先要求每道题都带 id，
        // 否则「4 道旧的 + 1 道新的」会被误判成和原来一样。
        const existing = listQuestionRows(id).map((q) => q.id);
        const allHaveId = incoming.every((q) => Boolean(q.id));
        const incomingIds = incoming.map((q) => q.id).filter((x): x is string => Boolean(x));
        const sameSet =
          allHaveId &&
          incoming.length === existing.length &&
          existing.length === incomingIds.length &&
          existing.every((qid) => incomingIds.includes(qid)) &&
          new Set(incomingIds).size === existing.length;
        if (!sameSet) {
          throw ApiError.conflict(
            `这份问卷已有 ${responses} 份答卷，不能再增删题目（否则老答案会对不上）。` +
              '如果确实要改结构，请新建一份问卷。',
          );
        }
        incoming.forEach((q, index) => {
          run(
            `UPDATE survey_questions
                SET sort_order = ?, kind = ?, title = ?, hint = ?, required = ?, options_json = ?, max_rating = ?
              WHERE id = ? AND survey_id = ?`,
            index,
            q.kind,
            q.title,
            q.hint,
            q.required ? 1 : 0,
            JSON.stringify(q.options),
            q.maxRating,
            q.id,
            id,
          );
        });
      } else {
        run('DELETE FROM survey_questions WHERE survey_id = ?', id);
        insertQuestions(id, incoming);
      }
    }

    patch.updated_at = nowIso();
    const keys = Object.keys(patch);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    run(`UPDATE surveys SET ${sets} WHERE id = ?`, ...keys.map((k) => patch[k]), id);
  });

  void row;
  return getSurveyDetail(id);
}

export function deleteSurvey(id: string): { removed: string } {
  requireSurveyRow(id);
  run('DELETE FROM surveys WHERE id = ?', id);
  return { removed: id };
}

/** 换一条新令牌：旧链接立刻失效，已收的答卷不受影响 */
export function rotateSurveyToken(id: string): SurveyDetail {
  requireSurveyRow(id);
  run('UPDATE surveys SET token = ?, updated_at = ? WHERE id = ?', newToken(), nowIso(), id);
  return getSurveyDetail(id);
}

/* ------------------------------------------------------------------ 坞主：答卷 */

export function listResponses(surveyId: string): SurveyResponseItem[] {
  requireSurveyRow(surveyId);
  const rows = all<ResponseRow>(
    'SELECT * FROM survey_responses WHERE survey_id = ? ORDER BY submitted_at DESC',
    surveyId,
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const answers = all<AnswerRow>(
    `SELECT * FROM survey_answers WHERE response_id IN (${placeholders})`,
    ...ids,
  );
  const byResponse = new Map<string, AnswerRow[]>();
  for (const a of answers) {
    const list = byResponse.get(a.response_id) ?? [];
    list.push(a);
    byResponse.set(a.response_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    submittedAt: r.submitted_at,
    answers: (byResponse.get(r.id) ?? []).map((a) => ({
      questionId: a.question_id,
      value: parseJson<SurveyAnswerValue>(a.value_json, null),
    })),
  }));
}

function csvCell(value: string): string {
  let s = value ?? '';
  // 防公式注入：Excel/Sheets 会把 = + - @ 开头的单元格当公式执行
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function answerToText(value: SurveyAnswerValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(' | ');
  return String(value);
}

/** 导出 CSV：一行一份答卷，列顺序与题目顺序一致 */
export function exportResponsesCsv(surveyId: string): { filename: string; csv: string } {
  const survey = requireSurveyRow(surveyId);
  const questions = listQuestionRows(surveyId).map(toQuestion);
  const responses = listResponses(surveyId).reverse(); // 按提交时间正序，便于按时间看

  const header = ['提交时间', ...questions.map((q, i) => `${i + 1}. ${q.title}`)];
  const lines: string[] = [header.map(csvCell).join(',')];

  for (const r of responses) {
    const byQuestion = new Map(r.answers.map((a) => [a.questionId, a.value]));
    lines.push(
      [
        csvCell(new Date(r.submittedAt).toISOString().replace('T', ' ').slice(0, 19)),
        ...questions.map((q) => csvCell(answerToText(byQuestion.get(q.id) ?? null))),
      ].join(','),
    );
  }

  const safeTitle = survey.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'survey';
  return { filename: `${safeTitle}_答卷.csv`, csv: `${lines.join('\r\n')}\r\n` };
}

/* ------------------------------------------------------------------ 公开：填答 */

export function getPublicSurvey(token: string): PublicSurvey {
  const row = findSurveyByToken(token);
  if (!row) throw ApiError.notFound('问卷不存在，或链接已失效');
  const responses = countResponses(row.id);
  const state = surveyState(row, responses);
  return {
    title: row.title,
    descriptionMd: row.description_md,
    status: row.status as SurveyStatus,
    expiresAt: row.expires_at,
    accepting: state.accepting,
    closedReason: state.closedReason,
    questions: listQuestionRows(row.id).map(toQuestion),
  };
}

/** 把一道题的作答值校验并规范成可落库的形状 */
function normalizeAnswer(q: SurveyQuestion, raw: unknown): SurveyAnswerValue {
  const empty =
    raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);

  if (empty) {
    if (q.required) throw ApiError.badRequest(`「${q.title}」是必填的`);
    return null;
  }

  switch (q.kind) {
    case 'single': {
      if (typeof raw !== 'string') throw ApiError.badRequest(`「${q.title}」的答案格式不对`);
      if (!q.options.includes(raw)) throw ApiError.badRequest(`「${q.title}」选了不存在的选项`);
      return raw;
    }
    case 'multiple': {
      if (!Array.isArray(raw)) throw ApiError.badRequest(`「${q.title}」的答案格式不对`);
      const picked: string[] = [];
      for (const v of raw) {
        if (typeof v !== 'string' || !q.options.includes(v)) {
          throw ApiError.badRequest(`「${q.title}」选了不存在的选项`);
        }
        if (!picked.includes(v)) picked.push(v);
      }
      if (picked.length === 0) {
        if (q.required) throw ApiError.badRequest(`「${q.title}」是必填的`);
        return null;
      }
      return picked;
    }
    case 'rating': {
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > q.maxRating) {
        throw ApiError.badRequest(`「${q.title}」只能打 1..${q.maxRating} 分`);
      }
      return n;
    }
    case 'text':
    case 'paragraph': {
      if (typeof raw !== 'string') throw ApiError.badRequest(`「${q.title}」的答案格式不对`);
      const t = raw.trim();
      if (!t) {
        if (q.required) throw ApiError.badRequest(`「${q.title}」是必填的`);
        return null;
      }
      if (t.length > MAX_TEXT_ANSWER) {
        throw ApiError.badRequest(`「${q.title}」超过 ${MAX_TEXT_ANSWER} 字`);
      }
      return t;
    }
    default:
      return null;
  }
}

export function submitResponse(
  token: string,
  rawAnswers: unknown,
  visitorHash: string,
  ua: string,
): { submittedAt: string } {
  const row = findSurveyByToken(token);
  if (!row) throw ApiError.notFound('问卷不存在，或链接已失效');

  const responses = countResponses(row.id);
  const state = surveyState(row, responses);
  if (!state.accepting) throw ApiError.conflict(state.closedReason);

  if (row.one_per_visitor === 1 && visitorHash) {
    const dup = get<{ id: string }>(
      'SELECT id FROM survey_responses WHERE survey_id = ? AND visitor_hash = ?',
      row.id,
      visitorHash,
    );
    if (dup) throw ApiError.conflict('这个浏览器已经提交过了');
  }

  const questions = listQuestionRows(row.id).map(toQuestion);
  const incoming =
    rawAnswers && typeof rawAnswers === 'object' ? (rawAnswers as Record<string, unknown>) : {};

  const normalized: { questionId: string; value: SurveyAnswerValue }[] = [];
  for (const q of questions) {
    const value = normalizeAnswer(q, incoming[q.id]);
    normalized.push({ questionId: q.id, value });
  }

  const responseId = newId('sr');
  const now = nowIso();

  tx(() => {
    run(
      'INSERT INTO survey_responses (id, survey_id, submitted_at, visitor_hash, ua) VALUES (?, ?, ?, ?, ?)',
      responseId,
      row.id,
      now,
      visitorHash,
      ua.slice(0, 300),
    );
    for (const a of normalized) {
      if (a.value === null) continue; // 没答的题不落行，导出时留空
      run(
        'INSERT INTO survey_answers (id, response_id, question_id, value_json) VALUES (?, ?, ?, ?)',
        newId('sa'),
        responseId,
        a.questionId,
        JSON.stringify(a.value),
      );
    }
  });

  return { submittedAt: now };
}

/** 坞主概览用：问卷总数与答卷总数 */
export function surveyStats(): { total: number; responses: number } {
  return {
    total: get<{ c: number }>('SELECT COUNT(*) AS c FROM surveys')?.c ?? 0,
    responses: get<{ c: number }>('SELECT COUNT(*) AS c FROM survey_responses')?.c ?? 0,
  };
}
