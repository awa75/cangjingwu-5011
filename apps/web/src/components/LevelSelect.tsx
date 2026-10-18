/**
 * 最低等级选择器（1..9）
 * 低于该等级的访客整条看不到这份内容：匿名按 0 级、会员按自己等级、坞主全看。
 */
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function LevelSelect({
  value,
  onChange,
  label,
  id,
  compact = false,
}: {
  value: number;
  onChange: (level: number) => void;
  label?: string;
  id?: string;
  /** 紧凑模式：用在表格单元格里，只显示 LVn */
  compact?: boolean;
}) {
  return (
    <span className="row level-select" style={{ gap: 6, alignItems: 'center' }}>
      {label && <span className="dim">{label}</span>}
      <select
        id={id}
        value={value}
        title="低于这个等级的访客看不到这份内容"
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            {l === 1 ? (compact ? 'LV1·公开' : 'LV1（所有人）') : compact ? `LV${l}` : `LV${l} 及以上`}
          </option>
        ))}
      </select>
    </span>
  );
}
