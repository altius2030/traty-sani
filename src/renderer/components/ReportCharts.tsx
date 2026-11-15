import { useState } from 'react';
import type { Report } from '../types';
import { formatMoney } from '../lib/format';
import { depositColorMap, expenseColorMap } from '../lib/reportColors';
import { assignChartColors } from '../lib/icons';

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
  onSliceClick,
}: {
  data: Slice[];
  total: number;
  centerLabel?: string;
  emptyLabel?: string;
  /** Клик по сектору — для перехода на уровень подкатегорий */
  onSliceClick?: (label: string) => void;
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
                className={onSliceClick ? 'chart-slice' : undefined}
                style={onSliceClick ? { cursor: 'pointer' } : undefined}
                onClick={onSliceClick ? () => onSliceClick(slice.label) : undefined}
              >
                <title>{`${slice.label}: ${formatMoney(slice.value)}`}</title>
              </circle>
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

/**
 * Траты по дням недели: в какие дни уходит больше всего.
 *
 * Показываем сумму, а не средний чек: вопрос именно «в какие дни тратите
 * больше». Число операций уезжает в подсказку — по нему видно, большая ли
 * сумма за счёт одной крупной траты или за счёт частых мелких.
 */
function WeekdayChart({ points }: { points: { label: string; value: number; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));

  return (
    <div className="chart-weekday">
      {points.map((p) => (
        <div
          key={p.label}
          className="chart-weekday-col"
          title={`${p.label}: ${formatMoney(p.value)} · ${p.count} оп.`}
        >
          <div className="chart-weekday-track">
            <div
              className="chart-weekday-bar"
              style={{ height: `${(p.value / max) * 100}%` }}
            />
          </div>
          <div className="chart-weekday-value">{formatMoney(p.value)}</div>
          <div className="chart-weekday-label">{p.label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * График остатка по дням: накопительный баланс от начала периода.
 *
 * В отличие от столбцов трат/внесений, показывает не поток, а запас денег:
 * видно, когда он проседал и когда рос. Строится из той же истории, что и
 * карточка «Начало (база)»: старт + внесения − траты по дням.
 */
function BalanceChart({ points }: { points: { label: string; value: number }[] }) {
  const width = 560;
  const height = 180;
  const padX = 8;
  const padTop = 16;
  const padBottom = 26;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  if (points.length === 0) return <div className="chart-empty">Нет операций за период</div>;

  const values = points.map((p) => p.value);
  // Ноль всегда в шкале: уход в минус должен быть виден, а не обрезан.
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const x = (i: number) => padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padTop + innerH - ((v - min) / span) * innerH;

  const zeroY = y(0);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  return (
    <div className="chart-balance">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        {/* Линия нуля: по ней видно, уходил ли остаток в минус */}
        <line
          x1={padX}
          x2={width - padX}
          y1={zeroY}
          y2={zeroY}
          className="chart-balance-zero"
        />
        <path d={area} className="chart-balance-area" />
        <path d={line} className="chart-balance-line" />
      </svg>
      {/* Подписи дат: первая, середина, последняя — иначе при большом периоде
          подписи слипнутся в кашу */}
      <div className="chart-balance-labels">
        {points.length > 0 && <span>{points[0].label}</span>}
        {points.length > 2 && <span>{points[Math.floor(points.length / 2)].label}</span>}
        {points.length > 1 && <span>{points[points.length - 1].label}</span>}
      </div>
      <div className="chart-balance-range">
        <span>{formatMoney(max)}</span>
        <span>{formatMoney(min)}</span>
      </div>
    </div>
  );
}

/** Столбчатая диаграмма: траты по дням периода */
function BarChart({  data,
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
  // Уровень детализации: null — категории, строка — подкатегории этой категории.
  const [drill, setDrill] = useState<string | null>(null);
  // Цвета раздаёт общий модуль: те же оттенки показываются в точках таблиц
  // отчёта, иначе данные выглядели бы неоднозначно.
  const expenseColors = expenseColorMap(report);
  const expenseEntries = Object.entries(report.byCategory)
    .map(([label, v]) => ({ label, value: v.total }))
    .sort((a, b) => b.value - a.value);
  // Мелкие категории схлопываем в «Прочее», иначе кольцо превращается в
  // кашу из двухпиксельных секторов. Порог — 3% от итога. В таблице ниже
  // все категории остаются поимённо, поэтому данные не теряются.
  const rawTotal = expenseEntries.reduce((s, x) => s + x.value, 0);
  const OTHER_LABEL = 'Прочее';
  const OTHER_THRESHOLD = 0.03;
  const slices: Slice[] = [];
  let otherSum = 0;
  for (const e of expenseEntries) {
    if (rawTotal > 0 && e.value / rawTotal < OTHER_THRESHOLD) {
      otherSum += e.value;
    } else {
      slices.push({ ...e, color: expenseColors[e.label] });
    }
  }
  if (otherSum > 0) {
    slices.push({ label: OTHER_LABEL, value: otherSum, color: '#9aa4b2' });
  }

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

  // Остаток по дням: старт периода + накопительный итог внесений и трат.
  // Используем полный набор дней (не .slice(0,31)), иначе график обрывался бы
  // на первом месяце квартала. Подписей всё равно три, так что длинный
  // период читается.
  const balancePoints = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({
      label: new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      value: v.deposit - v.expense,
    }));
  let running = report.startBalance;
  const balanceSeries = balancePoints.map((p) => {
    running += p.value;
    return { label: p.label, value: running };
  });

  // Траты по дням недели. Порядок — с понедельника, как привычнее в
  // деловом календаре; getDay() считает воскресенье нулём, поэтому сдвигаем.
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const wdMap = new Map<number, { value: number; count: number }>();
  for (const e of report.expenses) {
    const day = new Date(`${e.date}T00:00:00`).getDay();
    const idx = (day + 6) % 7;
    const cur = wdMap.get(idx) || { value: 0, count: 0 };
    cur.value += e.amount;
    cur.count += 1;
    wdMap.set(idx, cur);
  }
  const weekdaySeries = WD.map((label, idx) => ({
    label,
    value: wdMap.get(idx)?.value ?? 0,
    count: wdMap.get(idx)?.count ?? 0,
  }));

  const wantExpenses = mode !== 'deposits';
  const wantDeposits = mode !== 'expenses';
  const showExpenseDonut = wantExpenses && slices.length > 0;
  const showIncomeDonut = wantDeposits && incomeSlices.length > 0;
  const showDays = days.length > 0;

  // Детализация: подкатегории выбранной категории. Клик по сектору кольца.
  const drillData = drill ? report.byCategory[drill] : undefined;
  const drillSlices: Slice[] = (() => {
    if (!drillData) return [];
    const entries = Object.entries(drillData.subcategories)
      .map(([label, v]) => ({ label, value: v.total, color: null }))
      .sort((a, b) => b.value - a.value);
    const colors = assignChartColors(entries);
    return entries.map((s, i) => ({ ...s, color: colors[i] }));
  })();
  const drillTotal = drillSlices.reduce((s, x) => s + x.value, 0);
  // Подкатегории могут не покрывать всю категорию — остаток показываем
  // отдельным серым сектором «Без подкатегории», иначе кольцо соврёт.
  const drillRest = drillData ? drillData.total - drillTotal : 0;

  if (!showExpenseDonut && !showIncomeDonut && !showDays) {
    return null;
  }

  return (
    <div className="charts-block">
      {showExpenseDonut && !drill && (
        <div className="chart-card">
          <div className="breakdown-title">Расходы по категориям</div>
          <DonutChart data={slices} total={total} onSliceClick={(label) => setDrill(label)} />
          <div className="chart-hint">Нажмите на категорию, чтобы увидеть подкатегории</div>
        </div>
      )}

      {showExpenseDonut && drill && (
        <div className="chart-card">
          <div className="breakdown-title">
            {drill}: подкатегории
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 12, padding: '2px 8px', fontSize: 12 }}
              onClick={() => setDrill(null)}
            >
              ← Все категории
            </button>
          </div>
          {drillSlices.length > 0 ? (
            <DonutChart
              data={
                drillRest > 0
                  ? [...drillSlices, { label: 'Без подкатегории', value: drillRest, color: '#9aa4b2' }]
                  : drillSlices
              }
              total={drillData!.total}
              centerLabel={drill}
            />
          ) : (
            <div className="chart-empty">У этой категории нет подкатегорий</div>
          )}
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

      {balanceSeries.length > 0 && (
        <div className="chart-card">
          <div className="breakdown-title">Остаток по дням</div>
          <BalanceChart points={balanceSeries} />
        </div>
      )}

      {wantExpenses && weekdaySeries.some((d) => d.count > 0) && (
        <div className="chart-card">
          <div className="breakdown-title">Траты по дням недели</div>
          <div className="chart-hint">Сумма трат за все дни недели периода</div>
          <WeekdayChart points={weekdaySeries} />
        </div>
      )}
    </div>
  );
}

/**
 * Календарный вид: сетка месяца с суммой трат и внесений по дням.
 *
 * Показывает не «сколько всего», а ритм: в какие дни были закупы, где
 * провалы. Пустые дни не рисуем цифр — сетка остаётся читаемой.
 */
export function CalendarView({
  report,
  month,
  onPrev,
  onNext,
}: {
  report: Report;
  /** 'YYYY-MM' — какой месяц показывать */
  month: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // Смещение первого дня: понедельник — первый столбец
  const lead = (first.getDay() + 6) % 7;

  const byDay = new Map<number, { expense: number; deposit: number }>();
  for (const e of report.expenses) {
    const d = new Date(`${e.date}T00:00:00`).getDate();
    const cur = byDay.get(d) || { expense: 0, deposit: 0 };
    cur.expense += e.amount;
    byDay.set(d, cur);
  }
  for (const dep of report.deposits) {
    const d = new Date(`${dep.date}T00:00:00`).getDate();
    const cur = byDay.get(d) || { expense: 0, deposit: 0 };
    cur.deposit += dep.amount;
    byDay.set(d, cur);
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const monthName = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button className="btn btn-ghost" onClick={onPrev} aria-label="Предыдущий месяц">
          ←
        </button>
        <div className="calendar-title">{monthName}</div>
        <button className="btn btn-ghost" onClick={onNext} aria-label="Следующий месяц">
          →
        </button>
      </div>
      <div className="calendar-grid">
        {WD.map((w) => (
          <div key={w} className="calendar-wd">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} className="calendar-cell empty" />;
          const v = byDay.get(day);
          return (
            <div key={day} className="calendar-cell">
              <div className="calendar-day">{day}</div>
              {v && v.expense > 0 && (
                <div className="calendar-expense" title={`Траты ${formatMoney(v.expense)}`}>
                  −{formatMoney(v.expense)}
                </div>
              )}
              {v && v.deposit > 0 && (
                <div className="calendar-deposit" title={`Внесения ${formatMoney(v.deposit)}`}>
                  +{formatMoney(v.deposit)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span className="calendar-legend-item">
          <span className="calendar-swatch calendar-swatch-expense" />
          траты
        </span>
        <span className="calendar-legend-item">
          <span className="calendar-swatch calendar-swatch-deposit" />
          внесения
        </span>
      </div>
    </div>
  );
}

/** Данные для графиков попадают и в CSV — отдельными секциями */export function buildChartCsv(report: Report): string[] {
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