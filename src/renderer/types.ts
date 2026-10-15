export interface Subcategory {
  id: number;
  name: string;
  is_custom: number;
  sort_order: number;
}

export interface Category {
  id: number;
  name: string;
  type: string;
  is_custom: number;
  sort_order: number;
  /** Ключ значка из набора в lib/icons.ts */
  icon?: string | null;
  subcategories?: Subcategory[] | string | null;
}

export interface Expense {
  id: number;
  category_id: number;
  subcategory_id: number | null;
  amount: number;
  date: string;
  note: string | null;
  category_name: string;
  category_icon?: string | null;
  subcategory_name: string | null;
}

export interface BalanceRecord {
  id: number;
  amount: number;
  date: string;
  note: string | null;
}

export interface Deposit {
  id: number;
  amount: number;
  date: string;
  /** Комментарий обязателен */
  note: string;
  created_at?: string;
}

export interface CategoryBreakdown {
  total: number;
  subcategories: Record<string, number>;
}

export interface Report {
  /** Остаток на начало периода (отметка + операции после неё) */
  startBalance: number;
  /** Деньги на выходе: после всех внесений и вычетов */
  endBalance: number;
  totalExpenses: number;
  totalDeposits: number;
  /** Отметка «Указать остаток», на которую опирается расчёт */
  baseCheckpoint: { amount: number; date: string | null };
  expenses: Expense[];
  deposits: Deposit[];
  byCategory: Record<string, CategoryBreakdown>;
  period: { startDate: string; endDate: string };
}

export type PeriodPreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface Period {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
}

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}