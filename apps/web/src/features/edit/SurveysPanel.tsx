/**
 * 编辑台 · 问卷面板
 *
 * 三块视图：列表 → 编辑（新建/修改）→ 答卷。
 * 问卷**不在站内任何导航里**：唯一的对外入口是坞主复制出去的那条 /q/<token> 链接。
 *
 * 复用现有类名（card / panel / field / btn / notice / tag / dim），只为问卷补了少量
 * 排版类（.survey-* / .q-*），见 pages.css 末尾。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SurveyDetail,
  SurveyItem,
  SurveyQuestionKind,
  SurveyResponseItem,
} from '@cangjingwu/shared';
import { surveysApi, ApiError, type SurveyQuestionInput } from '@/lib/api';
import { copyText, formatDateTime } from '@/lib/format';
import { EmptyState, ErrorBox, Loading } from '@/components/Bits';
import { useToast } from '@/components/Toast';

/* ------------------------------------------------------------------ 草稿 */

interface QDraft {
  id?: string;
  kind: SurveyQuestionKind;
  title: string;
  hint: string;
  required: boolean;
  /** textarea，一行一个选项 */
  options: string;
  maxRating: number;
}

interface Draft {
  title: string;
  descriptionMd: string;
  /** yyyy-mm-dd；空 = 不限期 */
  expiresDate: string;
  maxResponses: string;
  onePerVisitor: boolean;
  questions: QDraft[];
}

const KIND_LABEL: Record<SurveyQuestionKind, string> = {
  single: '单选',
  multiple: '多选',
  text: '填空',
  paragraph: '长文本',
  rating: '评分',
};

const emptyQuestion = (): QDraft => ({
  kind: 'single',
  title: '',
  hint: '',
  required: true,
  options: '',
  maxRating: 5,
});

function emptyDraft(): Draft {
  return {
    title: '',
    descriptionMd: '',
    expiresDate: '',
    maxResponses: '',
    onePerVisitor: true,
    questions: [{ ...emptyQuestion(), title: '', options: '选项一\n选项二' }],
  };
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toIsoFromDate(date: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function draftFromDetail(detail: SurveyDetail): Draft {
  return {
    title: detail.title,
    descriptionMd: detail.descriptionMd,
    expiresDate: toDateInput(detail.expiresAt),
    maxResponses: detail.maxResponses === null ? '' : String(detail.maxResponses),
    onePerVisitor: detail.onePerVisitor,
    questions: detail.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      title: q.title,
      hint: q.hint,
      required: q.required,
      options: q.options.join('\n'),
      maxRating: q.maxRating,
    })),
  };
}

function draftToInput(draft: Draft): {
  title: string;
  descriptionMd: string;
  expiresAt: string | null;
  maxResponses: number | null;
  onePerVisitor: boolean;
  questions: SurveyQuestionInput[];
} {
  return {
    title: draft.title.trim(),
    descriptionMd: draft.descriptionMd,
    expiresAt: toIsoFromDate(draft.expiresDate),
    maxResponses: draft.maxResponses.trim() ? Number(draft.maxResponses) : null,
    onePerVisitor: draft.onePerVisitor,
    questions: draft.questions.map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      kind: q.kind,
      title: q.title.trim(),
      hint: q.hint.trim(),
      required: q.required,
      options: q.options
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      maxRating: q.maxRating,
    })),
  };
}

function absoluteLink(path: string): string {
  return `${window.location.origin}${path}`;
}

/* ------------------------------------------------------------------ 列表 */

export function SurveysPanel() {
  const toast = useToast();
  const [items, setItems] = useState<SurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<
    | { kind: 'list' }
    | { kind: 'edit'; detail: SurveyDetail | null }
    | { kind: 'responses'; id: string; title: string }
  >({ kind: 'list' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await surveysApi.list();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode.kind === 'list') void load();
  }, [mode, load]);

  if (mode.kind === 'edit') {
    return (
      <SurveyEditor
        detail={mode.detail}
        onDone={() => {
          setMode({ kind: 'list' });
          void load();
        }}
        onCancel={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'responses') {
    return (
      <SurveyResponses
        id={mode.id}
        title={mode.title}
        onBack={() => setMode({ kind: 'list' })}
      />
    );
  }

  const copy = async (path: string) => {
    try {
      await copyText(absoluteLink(path));
      toast.push('链接已复制', 'ok');
    } catch {
      toast.push('复制失败，请手动选择文本框里的内容', 'err');
    }
  };

  const toggle = async (s: SurveyItem) => {
    try {
      await surveysApi.update(s.id, { status: s.status === 'open' ? 'closed' : 'open' });
      await load();
      toast.push(s.status === 'open' ? '已停止收集' : '已重新开放', 'ok');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : '操作失败', 'err');
    }
  };

  const rotate = async (s: SurveyItem) => {
    if (!window.confirm('换链接后，已经发出去的旧链接会立刻失效。确定吗？')) return;
    try {
      await surveysApi.rotate(s.id);
      await load();
      toast.push('已换新链接，旧链接失效', 'ok');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : '操作失败', 'err');
    }
  };

  const remove = async (s: SurveyItem) => {
    if (!window.confirm(`删除「${s.title}」？它的 ${s.responseCount} 份答卷会一起删掉，无法恢复。`)) return;
    try {
      await surveysApi.remove(s.id);
      await load();
      toast.push('已删除', 'ok');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : '删除失败', 'err');
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setMode({ kind: 'edit', detail: null })}
        >
          新建问卷
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          刷新
        </button>
        <span className="dim">问卷不在任何导航里，只有你复制出去的链接能打开</span>
      </div>

      {loading && <Loading text="正在取问卷…" />}
      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState title="还没有问卷" hint="点「新建问卷」做一份，再把链接发给要填的人。" />
      )}

      {items.map((s) => (
        <div key={s.id} className="card panel survey-row">
          <div className="survey-row-main">
            <div className="survey-row-head">
              <strong>{s.title}</strong>
              <span className={`tag${s.status === 'open' ? '' : ' tag-off'}`}>
                {s.status === 'open' ? '收集中' : '已关闭'}
              </span>
              {!s.accepting && s.status === 'open' && <span className="tag tag-off">{s.closedReason}</span>}
            </div>
            <p className="dim survey-row-meta">
              {s.questionCount} 题 · 已收 {s.responseCount} 份
              {s.maxResponses !== null ? ` / 上限 ${s.maxResponses}` : ''}
              {s.expiresAt ? ` · 截止 ${formatDateTime(s.expiresAt)}` : ' · 不限期'}
              {s.onePerVisitor ? ' · 同浏览器限一份' : ''}
            </p>
            <div className="survey-link">
              <input readOnly value={absoluteLink(s.path)} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy(s.path)}>
                复制
              </button>
            </div>
          </div>

          <div className="row survey-row-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setMode({ kind: 'responses', id: s.id, title: s.title })}
            >
              看答卷 {s.responseCount}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                try {
                  const detail = await surveysApi.get(s.id);
                  setMode({ kind: 'edit', detail });
                } catch (e) {
                  toast.push(e instanceof Error ? e.message : '打不开', 'err');
                }
              }}
            >
              编辑
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void toggle(s)}>
              {s.status === 'open' ? '停止收集' : '重新开放'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void rotate(s)}>
              换链接
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(s)}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 编辑 */

function SurveyEditor({
  detail,
  onDone,
  onCancel,
}: {
  detail: SurveyDetail | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => (detail ? draftFromDetail(detail) : emptyDraft()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const locked = Boolean(detail && detail.responseCount > 0);

  const setQ = (index: number, patch: Partial<QDraft>) => {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));
  };

  const addQ = () => setDraft((d) => ({ ...d, questions: [...d.questions, emptyQuestion()] }));

  const removeQ = (index: number) =>
    setDraft((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== index) }));

  const moveQ = (index: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.questions];
      const target = index + dir;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...d, questions: next };
    });

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const input = draftToInput(draft);
      if (!input.title) throw new Error('请给问卷起个标题');
      if (detail) {
        await surveysApi.update(detail.id, input);
        toast.push('已保存', 'ok');
      } else {
        await surveysApi.create({ ...input, title: input.title });
        toast.push('问卷已创建，去列表复制链接', 'ok');
      }
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ‹ 返回列表
        </button>
        <strong>{detail ? '编辑问卷' : '新建问卷'}</strong>
      </div>

      {locked && (
        <p className="notice">
          这份问卷已有 {detail?.responseCount} 份答卷，题目**只能改文字，不能增删**（否则老答案会对不上）。
          要改结构请新建一份。
        </p>
      )}

      <div className="card panel">
        <div className="field">
          <label>标题</label>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="例如：2026 秋季课程反馈"
          />
        </div>

        <div className="field">
          <label>说明（可选，支持 Markdown）</label>
          <textarea
            rows={3}
            value={draft.descriptionMd}
            onChange={(e) => setDraft({ ...draft, descriptionMd: e.target.value })}
            placeholder="开场白、填写须知……"
          />
        </div>

        <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: '12rem' }}>
            <label>截止日期（留空 = 不限期）</label>
            <input
              type="date"
              value={draft.expiresDate}
              onChange={(e) => setDraft({ ...draft, expiresDate: e.target.value })}
            />
          </div>
          <div className="field" style={{ minWidth: '10rem' }}>
            <label>最多收多少份（留空 = 不限）</label>
            <input
              type="number"
              min={1}
              value={draft.maxResponses}
              onChange={(e) => setDraft({ ...draft, maxResponses: e.target.value })}
            />
          </div>
          <label className="check" style={{ alignSelf: 'center' }}>
            <input
              type="checkbox"
              checked={draft.onePerVisitor}
              onChange={(e) => setDraft({ ...draft, onePerVisitor: e.target.checked })}
            />
            <span>同一浏览器只收一份</span>
          </label>
        </div>
      </div>

      <h3 style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>题目（{draft.questions.length}）</h3>

      {draft.questions.map((q, i) => (
        <div key={q.id ?? `new-${i}`} className="card panel q-edit">
          <div className="row q-edit-head">
            <span className="tag">{i + 1}</span>
            <select
              value={q.kind}
              onChange={(e) => setQ(i, { kind: e.target.value as SurveyQuestionKind })}
              disabled={locked && Boolean(q.id)}
            >
              {(Object.keys(KIND_LABEL) as SurveyQuestionKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              className="q-edit-title"
              value={q.title}
              onChange={(e) => setQ(i, { title: e.target.value })}
              placeholder="题干"
            />
            <label className="check">
              <input
                type="checkbox"
                checked={q.required}
                onChange={(e) => setQ(i, { required: e.target.checked })}
              />
              <span>必答</span>
            </label>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveQ(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => moveQ(i, 1)}
              disabled={i === draft.questions.length - 1}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => removeQ(i)}
              disabled={locked && Boolean(q.id)}
            >
              删除
            </button>
          </div>

          <div className="field">
            <label>提示（可选）</label>
            <input value={q.hint} onChange={(e) => setQ(i, { hint: e.target.value })} />
          </div>

          {(q.kind === 'single' || q.kind === 'multiple') && (
            <div className="field">
              <label>选项（一行一个）</label>
              <textarea
                rows={Math.min(8, Math.max(3, q.options.split('\n').length))}
                value={q.options}
                onChange={(e) => setQ(i, { options: e.target.value })}
              />
            </div>
          )}

          {q.kind === 'rating' && (
            <div className="field" style={{ maxWidth: '10rem' }}>
              <label>满分</label>
              <select value={q.maxRating} onChange={(e) => setQ(i, { maxRating: Number(e.target.value) })}>
                {[3, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} 分
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}

      <div className="row" style={{ margin: 'var(--sp-3) 0' }}>
        <button type="button" className="btn btn-ghost" onClick={addQ} disabled={locked}>
          + 加一题
        </button>
      </div>

      {err && <p className="notice notice-error">{err}</p>}

      <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? '保存中…' : detail ? '保存' : '创建'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 答卷 */

function SurveyResponses({ id, title, onBack }: { id: string; title: string; onBack: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<SurveyDetail | null>(null);
  const [responses, setResponses] = useState<SurveyResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, r] = await Promise.all([surveysApi.get(id), surveysApi.responses(id)]);
      setDetail(d);
      setResponses(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 单选/多选/评分的粗统计：够看清分布，不做显著性检验 */
  const summary = useMemo(() => {
    if (!detail) return [];
    return detail.questions.map((q) => {
      const values = responses
        .map((r) => r.answers.find((a) => a.questionId === q.id)?.value)
        .filter((v) => v !== undefined && v !== null);
      if (q.kind === 'rating') {
        const nums = values.map(Number).filter((n) => Number.isFinite(n));
        const avg = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
        return { q, kind: 'rating' as const, answered: nums.length, avg };
      }
      if (q.kind === 'single' || q.kind === 'multiple') {
        const counts = q.options.map((opt) => ({
          opt,
          n: values.filter((v) => (Array.isArray(v) ? v.includes(opt) : v === opt)).length,
        }));
        return { q, kind: 'choice' as const, answered: values.length, counts };
      }
      return { q, kind: 'text' as const, answered: values.length };
    });
  }, [detail, responses]);

  const exportCsv = async () => {
    try {
      const blob = await surveysApi.exportCsv(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}_答卷.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.push('已导出', 'ok');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : '导出失败', 'err');
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ‹ 返回列表
        </button>
        <strong>{title}</strong>
        <span className="dim">共 {responses.length} 份</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void exportCsv()}>
          导出 CSV
        </button>
      </div>

      {loading && <Loading text="正在取答卷…" />}
      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {!loading && !error && responses.length === 0 && (
        <EmptyState title="还没有人填" hint="把链接发出去，答卷会出现在这里。" />
      )}

      {!loading && !error && detail && responses.length > 0 && (
        <>
          <div className="card panel">
            <h3 style={{ marginTop: 0 }}>分布</h3>
            {summary.map((s, i) => (
              <div key={s.q.id} className="q-summary">
                <div className="q-summary-title">
                  {i + 1}. {s.q.title}
                  <span className="dim"> · {s.answered} 人答</span>
                </div>
                {s.kind === 'rating' && (
                  <div className="q-summary-line">
                    平均 <strong>{s.avg.toFixed(2)}</strong> / {s.q.maxRating}
                  </div>
                )}
                {s.kind === 'choice' &&
                  s.counts.map((c) => {
                    const pct = s.answered ? Math.round((c.n / s.answered) * 100) : 0;
                    return (
                      <div key={c.opt} className="q-bar-row">
                        <span className="q-bar-label">{c.opt}</span>
                        <span className="q-bar" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="q-bar-num">
                          {c.n} · {pct}%
                        </span>
                      </div>
                    );
                  })}
                {s.kind === 'text' && <div className="dim">文本题，逐条见下方</div>}
              </div>
            ))}
          </div>

          <h3 style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>逐份</h3>
          {responses.map((r, idx) => (
            <div key={r.id} className="card panel">
              <div className="dim" style={{ marginBottom: 'var(--sp-2)' }}>
                第 {responses.length - idx} 份 · {formatDateTime(r.submittedAt)}
              </div>
              {detail.questions.map((q, qi) => {
                const v = r.answers.find((a) => a.questionId === q.id)?.value;
                return (
                  <div key={q.id} className="q-answer-row">
                    <span className="dim">
                      {qi + 1}. {q.title}
                    </span>
                    <span>
                      {v === null || v === undefined
                        ? '（未答）'
                        : Array.isArray(v)
                          ? v.join('、')
                          : String(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
