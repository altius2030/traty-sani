import type { Report } from '../types';
import { assignChartColors } from './icons';

/**
 * Цвета секторов для отчёта.
 *
 * Раздача вынесена отдельно от компонента графиков, потому что один и тот же
 * цвет должен использоваться и в кольце, и в точках таблиц. Иначе категория
 * без выбранного цвета в кольце получала один оттенок, а в таблице — другой
 * (там подставлялся --accent-primary), и данные выглядели бы неоднозначно.
 */

export type ColorMap = Record<string, string>;

/** Записи, отсортированные по убыванию суммы — в том же порядке, что сектора */
function byAmount<T>(entries: [string, T][], total: (v: T) => number): [string, T][] {
  return [...entries].sort((a, b) => total(b[1]) - total(a[1]));
}

function toMap(labels: string[], colors: string[]): ColorMap {
  return Object.fromEntries(labels.map((label, i) => [label, colors[i]]));
}

/** Цвета категорий трат — как в кольцевой диаграмме расходов */
export function expenseColorMap(report: Report): ColorMap {
  const entries = byAmount(Object.entries(report.byCategory), (v) => v.total);
  const colors = assignChartColors(entries.map(([, v]) => ({ color: v.color })));
  return toMap(entries.map(([label]) => label), colors);
}

/** Цвета категорий внесений — как в кольце «Приход по категориям» */
export function depositColorMap(report: Report): ColorMap {
  const source = report.byDepositCategory || {};
  const entries = byAmount(Object.entries(source), (v) => v.total);
  const colors = assignChartColors(entries.map(([, v]) => ({ color: v.color })));
  return toMap(entries.map(([label]) => label), colors);
}