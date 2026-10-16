import type { Report } from '../types';
import { formatMoney } from '../lib/format';
import { depositColorMap, expenseColorMap } from '../lib/reportColors';

/**
 * Графики для отчёта. Сделаны на голом SVG, без внешних библиотек:
 * приложение работает офлайн, а лишние зависимости увеличивают сборку.
 */

/** Какая вкладка отчёта открыта — определяет, чьи графики показывать */
export type ChartMode = 'all' | 'expenses' | 'deposits';

interface Slice {
  label: string;
  value: number;
  color: string;
  chosen?: string | null;
}

/** Кольцевая диаграмма расходов по категориям */
function DonutChart({
  data,
  total,
  centerLabel = 'Всего',
  emptyLabel = 'Нет расходов за период',
}: {
  data: Slice[];
  total: number;
  centerLabel?: string;
  emptyLabel?: string;
}) {
  const size = 200;
  const stroke = 34;
  const gap = 2; // зазор между секторами в единицах длины дуги
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  if (data.length === 0 || total <= 0) {
    return <div className="chart-empty">{emptyLabel}</div>;
  }

  let offset = 0;

  return (
    <div className="chart-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((slice) => {
            const fraction = slice.value / total;
            const full = fraction * circumference;
            // У коротких секторов зазор не съел бы всю дугу
            const gapHere = data.length > 1 ? Math.min(gap, full * 0.4) : 0;
            const length = Math.max(full - gapHere, 0.5);
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
                strokeDashoffset={-(offset + gapHere / 2)}
                strokeLinecap="butt"
              />
            );
            offset += full;
            return el;
          })}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          className="chart-center-label"
        >
          {centerLabel}
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
            <span className="chart-legend-pct">
              {total > 0 ? ((slice.value / total) * 100).toFixed(1) : '0.0'}%
            </span>
            <span className="chart-legend-value">{formatMoney(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Столбчатая диаграмма: траты по дням периода */
function BarChart({
  data,
  mode,
}: {
  data: { label: string; expense: number; deposit: number }[];
  mode: ChartMode;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.expense, d.deposit)));

  if (data.length === 0) {
    return <div className="chart-empty">Нет операций за период</div>;
  }

  const showExpense = mode !== 'deposits';
  const showDeposit = mode !== 'expenses';

  return (
    <div className="chart-bars">
      {data.map((d) => (
        <div key={d.label} className="chart-bar-col" title={`${d.label}: расход ${formatMoney(d.expense)}, внесено ${formatMoney(d.deposit)}`}>
          <div className="chart-bar-track">
            {showDeposit && d.deposit > 0 && (
              <div
                className="chart-bar chart-bar-deposit"
                style={{ height: `${(d.deposit / max) * 100}%` }}
              />
            )}
            {showExpense && d.expense > 0 && (
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

export default function ReportCharts({
  report,
  mode = 'all',
}: {
  report: Report;
  mode?: ChartMode;
}) {
  // Цвета раздаёт общий модуль: те же оттенки показываются в точках таблиц
  // отчёта, иначе данные выглядели бы неоднозначно.
  const expenseColors = expenseColorMap(report);
  const expenseEntries = Object.entries(report.byCategory)
    .map(([label, v]) => ({ label, value: v.total }))
    .sort((a, b) => b.value - a.value);
  const slices: Slice[] = expenseEntries.map((e) => ({
    ...e,
    color: expenseColors[e.label],
  }));

  const total = slices.reduce((s, x) => s + x.value, 0);

  // Приход по категориям внесений. Цвета берём из настроек категорий
  // внесений — те же, что показывает кольцо расходов, но свой справочник.
  const incomeColors = depositColorMap(report);
  const incomeEntries = Object.entries(report.byDepositCategory || {})
    .map(([label, v]) => ({ label, value: v.total }))
    .sort((a, b) => b.value - a.value);
  const incomeSlices: Slice[] = incomeEntries.map((e) => ({
    ...e,
    color: incomeColors[e.label],
  }));
  const incomeTotal = incomeSlices.reduce((s, x) => s + x.value, 0);

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

  const wantExpenses = mode !== 'deposits';
  const wantDeposits = mode !== 'expenses';
  const showExpenseDonut = wantExpenses && slices.length > 0;
  const showIncomeDonut = wantDeposits && incomeSlices.length > 0;
  const showDays = days.length > 0;

  if (!showExpenseDonut && !showIncomeDonut && !showDays) {
    return null;
  }

  return (
    <div className="charts-block">
      {showExpenseDonut && (
        <div className="chart-card">
          <div className="breakdown-title">Расходы по категориям</div>
          <DonutChart data={slices} total={total} />
        </div>
      )}

      {showIncomeDonut && (
        <div className="chart-card">
          <div className="breakdown-title">Приход по категориям</div>
          <DonutChart
            data={incomeSlices}
            total={incomeTotal}
            centerLabel="Приход"
            emptyLabel="Нет внесений за период"
          />
        </div>
      )}

      {showDays && (
        <div className="chart-card">
          <div className="breakdown-title">Динамика по дням</div>
          <div className="chart-legend chart-legend-inline">
            {wantExpenses && (
              <span className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: '#ff4757' }} />
                Траты
              </span>
            )}
            {wantDeposits && (
              <span className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: '#00d4aa' }} />
                Внесения
              </span>
            )}
          </div>
          <BarChart data={days} mode={mode} />
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

  const incomeEntries = Object.entries(report.byDepositCategory || {});
  if (incomeEntries.length > 0) {
    const incomeTotal = incomeEntries.reduce((s, [, v]) => s + v.total, 0);
    lines.push('');
    lines.push('ГРАФИК 2: приход по категориям');
    lines.push('Категория;Сумма;Доля,%');
    for (const [name, data] of incomeEntries) {
      const share = incomeTotal > 0 ? ((data.total / incomeTotal) * 100).toFixed(1) : '0.0';
      lines.push(`${name};${data.total.toFixed(2)};${share}`);
    }
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
    lines.push(`ГРАФИК ${incomeEntries.length > 0 ? 3 : 2}: динамика по дням`);
    lines.push('Дата;Траты;Внесения;Итого');
    for (const [date, v] of [...byDay.entries()].sort()) {
      lines.push(`${date};${v.expense.toFixed(2)};${v.deposit.toFixed(2)};${(v.deposit - v.expense).toFixed(2)}`);
    }
  }

  return lines;
}