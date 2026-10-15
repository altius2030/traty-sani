import type { Report } from '../types';
import { formatMoney } from '../lib/format';
import { getCategoryColor } from '../lib/icons';

/**
 * Графики для отчёта. Сделаны на голом SVG, без внешних библиотек:
 * приложение работает офлайн, а лишние зависимости увеличивают сборку.
 */

const PALETTE = [
  '#00d4aa',
  '#00a3e0',
  '#a855f7',
  '#ffb800',
  '#ff6b6b',
  '#4ecdc4',
  '#ff9f43',
  '#5f27cd',
  '#c8d6e5',
];

interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Кольцевая диаграмма расходов по категориям */
function DonutChart({ data, total }: { data: Slice[]; total: number }) {
  const size = 200;
  const stroke = 34;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  if (data.length === 0 || total <= 0) {
    return (
      <div className="chart-empty">Нет расходов за период</div>
    );
  }

  let offset = 0;

  return (
    <div className="chart-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((slice) => {
            const fraction = slice.value / total;
            const length = fraction * circumference;
            const dash = `${length} ${circumference - length}`;
            const el = (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += length;
            return el;
          })}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          className="chart-center-label"
        >
          Всего
        </text>
        <text x={size / 2} y={size / 2 + 20} textAnchor="middle" className="chart-center-value">
          {formatMoney(total)}
        </text>
      </svg>

      <div className="chart-legend">
        {data.map((slice) => (
          <div key={slice.label} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: slice.color }} />
            <span className="chart-legend-label" title={slice.label}>
              {slice.label}
            </span>
            <span className="chart-legend-value">{formatMoney(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Столбчатая диаграмма: траты по дням периода */
function BarChart({ data }: { data: { label: string; expense: number; deposit: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.expense, d.deposit)));

  if (data.length === 0) {
    return <div className="chart-empty">Нет операций за период</div>;
  }

  return (
    <div className="chart-bars">
      {data.map((d) => (
        <div key={d.label} className="chart-bar-col" title={`${d.label}: расход ${formatMoney(d.expense)}, внесено ${formatMoney(d.deposit)}`}>
          <div className="chart-bar-track">
            {d.deposit > 0 && (
              <div
                className="chart-bar chart-bar-deposit"
                style={{ height: `${(d.deposit / max) * 100}%` }}
              />
            )}
            {d.expense > 0 && (
              <div
                className="chart-bar chart-bar-expense"
                style={{ height: `${(d.expense / max) * 100}%` }}
              />
            )}
          </div>
          <div className="chart-bar-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function ReportCharts({ report }: { report: Report }) {
  // Цвет берём из значка категории, чтобы кольцо совпадало с боковой панелью
  const iconByCategory = new Map<string, string | null>();
  for (const e of report.expenses) {
    if (!iconByCategory.has(e.category_name)) {
      iconByCategory.set(e.category_name, e.category_icon ?? null);
    }
  }

  const slices: Slice[] = Object.entries(report.byCategory)
    .map(([label, v]) => ({ label, value: v.total, color: '' }))
    .sort((a, b) => b.value - a.value)
    .map((s, i) => ({
      ...s,
      color: iconByCategory.has(s.label)
        ? getCategoryColor(iconByCategory.get(s.label))
        : PALETTE[i % PALETTE.length],
    }));

  const total = slices.reduce((s, x) => s + x.value, 0);

  // Группируем операции по дням
  const byDay = new Map<string, { expense: number; deposit: number }>();
  for (const e of report.expenses) {
    const cur = byDay.get(e.date) || { expense: 0, deposit: 0 };
    cur.expense += e.amount;
    byDay.set(e.date, cur);
  }
  for (const d of report.deposits) {
    const cur = byDay.get(d.date) || { expense: 0, deposit: 0 };
    cur.deposit += d.amount;
    byDay.set(d.date, cur);
  }
  const days = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(0, 31)
    .map(([date, v]) => ({
      label: new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      expense: v.expense,
      deposit: v.deposit,
    }));

  if (slices.length === 0 && days.length === 0) {
    return null;
  }

  return (
    <div className="charts-block">
      {slices.length > 0 && (
        <div className="chart-card">
          <div className="breakdown-title">Расходы по категориям</div>
          <DonutChart data={slices} total={total} />
        </div>
      )}

      {days.length > 0 && (
        <div className="chart-card">
          <div className="breakdown-title">Динамика по дням</div>
          <div className="chart-legend chart-legend-inline">
            <span className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: '#ff4757' }} />
              Траты
            </span>
            <span className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: '#00d4aa' }} />
              Внесения
            </span>
          </div>
          <BarChart data={days} />
        </div>
      )}
    </div>
  );
}

/** Данные для графиков попадают и в CSV — отдельными секциями */
export function buildChartCsv(report: Report): string[] {
  const lines: string[] = [];

  lines.push('');
  lines.push('ГРАФИК 1: расходы по категориям');
  lines.push('Категория;Сумма;Доля,%');
  const total = Object.values(report.byCategory).reduce((s, c) => s + c.total, 0);
  for (const [name, data] of Object.entries(report.byCategory)) {
    const share = total > 0 ? ((data.total / total) * 100).toFixed(1) : '0.0';
    lines.push(`${name};${data.total.toFixed(2)};${share}`);
  }

  const byDay = new Map<string, { expense: number; deposit: number }>();
  for (const e of report.expenses) {
    const cur = byDay.get(e.date) || { expense: 0, deposit: 0 };
    cur.expense += e.amount;
    byDay.set(e.date, cur);
  }
  for (const d of report.deposits) {
    const cur = byDay.get(d.date) || { expense: 0, deposit: 0 };
    cur.deposit += d.amount;
    byDay.set(d.date, cur);
  }

  if (byDay.size > 0) {
    lines.push('');
    lines.push('ГРАФИК 2: динамика по дням');
    lines.push('Дата;Траты;Внесения;Итого');
    for (const [date, v] of [...byDay.entries()].sort()) {
      lines.push(`${date};${v.expense.toFixed(2)};${v.deposit.toFixed(2)};${(v.deposit - v.expense).toFixed(2)}`);
    }
  }

  return lines;
}