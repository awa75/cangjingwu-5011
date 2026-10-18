/**
 * 问卷填答页（/q/<token>）
 *
 * 这是一张「外发链接」：站内没有任何入口指向它，只有坞主把链接发出去才有人能到。
 * 所以它**不套 AppShell** —— 作答者看不到文库导航，也不会误以为自己进了站。
 *
 * 作答者不需要账号；「同一浏览器只能交一份」由服务端 cookie 判定，
 * 客户端只负责把必答题的空缺先挡一道，真正的校验在服务端。
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicSurvey, SurveyAnswerValue, SurveyQuestion } from '@cangjingwu/shared';
import { surveysApi } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useSite } from '@/hooks/useSite';
import { MdViewer } from '@/components/MdViewer';
import { ErrorBox, Loading } from '@/components/Bits';

function isEmpty(v: SurveyAnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function QuestionField({
  question,
  index,
  value,
  invalid,
  onChange,
}: {
  question: SurveyQuestion;
  index: number;
  value: SurveyAnswerValue | undefined;
  invalid: boolean;
  onChange: (v: SurveyAnswerValue) => void;
}) {
  const { kind, options, maxRating } = question;

  return (
    <div className={`q-item${invalid ? ' is-invalid' : ''}`}>
      <div className="q-title">
        <span className="q-no">{String(index + 1).padStart(2, '0')}</span>
        {question.title}
        {question.required && <span className="q-req">*</span>}
      </div>
      {question.hint && <p className="q-hint">{question.hint}</p>}

      {(kind === 'single' || kind === 'multiple') && (
        <div className="choice-list">
          {options.map((opt) => {
            const checked =
              kind === 'single' ? value === opt : Array.isArray(value) && value.includes(opt);
            return (
              <label key={opt} className={`choice${checked ? ' is-on' : ''}`}>
                <input
                  type={kind === 'single' ? 'radio' : 'checkbox'}
                  name={question.id}
                  checked={checked}
                  onChange={() => {
                    if (kind === 'single') {
                      onChange(opt);
                      return;
                    }
                    const cur = Array.isArray(value) ? value : [];
                    onChange(cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
                  }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}

      {kind === 'text' && (
        <input
          className="q-input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={5000}
        />
      )}

      {kind === 'paragraph' && (
        <textarea
          className="q-textarea"
          rows={5}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={5000}
        />
      )}

      {kind === 'rating' && (
        <div className="rating-row">
          {Array.from({ length: maxRating }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`rating-dot${value === n ? ' is-on' : ''}`}
              onClick={() => onChange(n)}
              aria-label={`${n} 分`}
            >
              {n}
            </button>
          ))}
          <span className="rating-hint">（{maxRating} 分制，{maxRating} 最高）</span>
        </div>
      )}

      {invalid && <p className="q-err">这题必填</p>}
    </div>
  );
}

function SurveyForm({ survey, token }: { survey: PublicSurvey; token: string }) {
  const { site } = useSite();
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [invalid, setInvalid] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [doneAt, setDoneAt] = useState<string | null>(null);

  const setAnswer = (id: string, v: SurveyAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
    setInvalid((prev) => prev.filter((x) => x !== id));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = survey.questions
      .filter((q) => q.required && isEmpty(answers[q.id]))
      .map((q) => q.id);
    setInvalid(missing);
    if (missing.length > 0) {
      setErr('还有必答题没填');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await surveysApi.submit(token, answers);
      setDoneAt(new Date(r.submittedAt).toLocaleString('zh-CN'));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  if (doneAt) {
    return (
      <div className="survey-page">
        <div className="card panel survey-done">
          <div className="empty-seal">收</div>
          <h1>{survey.title}</h1>
          <p className="dim">已提交 · {doneAt}</p>
          <p>谢谢。你的回答已经收进坞里，这份表单不需要再填一次。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="survey-page">
      <header className="survey-head">
        <p className="dim survey-brand">{site.site_name} · 问卷</p>
        <h1 className="survey-title">{survey.title}</h1>
        {survey.descriptionMd && (
          <div className="survey-desc">
            <MdViewer markdown={survey.descriptionMd} />
          </div>
        )}
      </header>

      <form onSubmit={onSubmit} className="card panel survey-form">
        {survey.questions.map((q, i) => (
          <QuestionField
            key={q.id}
            question={q}
            index={i}
            value={answers[q.id]}
            invalid={invalid.includes(q.id)}
            onChange={(v) => setAnswer(q.id, v)}
          />
        ))}

        {err && <p className="notice notice-error">{err}</p>}

        <div className="survey-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '提交中…' : '提交'}
          </button>
          <span className="dim">
            共 {survey.questions.length} 题
            {survey.questions.some((q) => q.required) ? ' · 带 * 的必答' : ''}
          </span>
        </div>
      </form>
    </div>
  );
}

export function SurveyFillPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { data, loading, error, reload } = useAsync(() => surveysApi.open(token), [token]);

  if (loading) return <Loading text="正在取问卷…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  if (!data.accepting) {
    return (
      <div className="survey-page">
        <div className="card panel survey-done">
          <div className="empty-seal">闭</div>
          <h1>{data.title}</h1>
          <p className="dim">{data.closedReason || '这份问卷当前不接受作答'}</p>
        </div>
      </div>
    );
  }

  return <SurveyForm survey={data} token={token} />;
}
