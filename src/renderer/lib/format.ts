import type { Period, PeriodPreset } from '../types';

/** Валюта приложения: казахстанский тенге */
export const CURRENCY = 'KZT';
const LOCALE = 'kk-KZ';

export function formatMoney(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getPresetPeriod(preset: PeriodPreset): Period {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = endOfDay(now);

  switch (preset) {
    case 'today':
      startDate = startOfDay(now);
      break;
    case 'week': {
      startDate = startOfDay(now);
      const day = startDate.getDay();
      const diff = day === 0 ? 6 : day - 1;
      startDate.setDate(startDate.getDate() - diff);
      break;
    }
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = startOfDay(startDate);
      break;
    case 'quarter': {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), quarterMonth, 1);
      startDate = startOfDay(startDate);
      break;
    }
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      startDate = startOfDay(startDate);
      break;
    case 'custom':
    default:
      startDate = startOfDay(now);
      break;
  }

  return { preset, startDate: toISODate(startDate), endDate: toISODate(endDate) };
}

export function getPeriodLabel(period: Period): string {
  if (period.preset !== 'custom') {
    const labels: Record<string, string> = {
      today: 'Сегодня',
      week: 'Неделя',
      month: 'Месяц',
      quarter: 'Квартал',
      year: 'Год',
    };
    return labels[period.preset] || 'Период';
  }
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const start = new Date(period.startDate).toLocaleDateString('ru-RU', opts);
  const end = new Date(period.endDate).toLocaleDateString('ru-RU', opts);
  return `${start} — ${end}`;
}

export function parseCategoriesSubcategories(raw: unknown): any[] {
  let list: any[] = [];
  if (!raw) return list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  // Гарантируем нужный порядок вывода в UI
  return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}