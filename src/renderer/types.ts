export interface Subitem {
  id: number;
  name: string;
  is_custom: number;
  sort_order: number;
}

export interface Subcategory {
  id: number;
  name: string;
  is_custom: number;
  sort_order: number;
  /** Третий уровень — статьи внутри подкатегории */
  items?: Subitem[] | string | null;
}

export interface Category {
  id: number;
  name: string;
  type: string;
  is_custom: number;
  sort_order: number;
  /** Ключ значка из набора в lib/icons.ts */
  icon?: string | null;
  /** Цвет категории — используется на графиках */
  color?: string | null;
  subcategories?: Subcategory[] | string | null;
}

export interface Expense {
  id: number;
  category_id: number;
  subcategory_id: number | null;
  /** Приходит из SELECT e.*, но раньше не использовалось — нужно для отмены удаления */
  subitem_id: number | null;
  amount: number;
  date: string;
  note: string | null;
  category_name: string;
  category_icon?: string | null;
  category_color?: string | null;
  subcategory_name: string | null;
  subitem_name?: string | null;
  /** Заполнено, если трата — это возврат займа */
  loan_id?: number | null;
  /** Момент создания записи; сохраняется при отмене удаления */
  created_at?: string;
}

export interface BalanceRecord {
  id: number;
  amount: number;
  date: string;
  note: string | null;
}

/**
 * Категория внесения. До 1.0.8 роль этой справочника играл свободный
 * комментарий; теперь одинаковые комментарии схлопываются в одну категорию.
 */
export interface DepositCategory {
  id: number;
  name: string;
  /** Цвет сектора на графике прихода */
  color: string | null;
  sort_order: number;
  /** Сколько внесений ссылается на категорию */
  deposits_count?: number;
}

export interface Deposit {
  id: number;
  amount: number;
  date: string;
  category_id: number | null;
  /** Название категории; null, если категория была удалена */
  category_name: string | null;
  /** Заполнено, если внесение — это деньги займа */
  loan_id?: number | null;
  /** Исторический комментарий; сохраняется при отмене удаления */
  note?: string | null;
  created_at?: string;
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const RECURRING_FREQUENCIES: {
  value: RecurringFrequency;
  label: string;
  /** Сколько раз за год — нужно для расчёта «в месяц» */
  perYear: number;
}[] = [
  { value: 'daily', label: 'Ежедневно', perYear: 365 },
  { value: 'weekly', label: 'Еженедельно', perYear: 52 },
  { value: 'monthly', label: 'Ежемесячно', perYear: 12 },
  { value: 'quarterly', label: 'Ежеквартально', perYear: 4 },
  { value: 'yearly', label: 'Ежегодно', perYear: 1 },
];

export interface RecurringItem {
  id: number;
  title: string;
  category_id: number;
  subcategory_id: number | null;
  subitem_id: number | null;
  amount: number;
  frequency: RecurringFrequency;
  /** Дата следующего платежа; если в прошлом — платёж просрочен */
  next_date: string;
  is_active: number;
  category_name: string;
  category_icon?: string | null;
  category_color?: string | null;
  subcategory_name: string | null;
}

/** Челонеское название периода для платежа */
export function frequencyLabel(frequency: RecurringFrequency): string {
  return (
    RECURRING_FREQUENCIES.find((f) => f.value === frequency)?.label ?? 'Ежемесячно'
  );
}

/** Одно срабатывание платежа в календаре */
export interface RecurringOccurrence {
  date: string;
  title: string;
  amount: number;
  category_name: string;
  category_color: string | null;
}

/**
 * Заём: взяли на закуп, вернули через пару дней.
 *
 * Внесение при получении и трата при возврате помечены loan_id. Деньги идут
 * через обычные таблицы — остаток считается сам, — но в доходы и расходы
 * не попадают: заёмные деньги не заработаны и не потрачены.
 */
export interface LoanItem {
  id: number;
  title: string;
  /** Кто дал: банк, человек, касса */
  source: string | null;
  /** Сколько взяли по факту — сумма внесённых записей */
  amount: number;
  date_taken: string;
  date_due: string;
  note: string | null;
  /** Фактически поступило по внесениям */
  taken: number;
  /** Фактически возвращено по тратам */
  repaid: number;
  /** Сколько ещё нужно вернуть */
  remaining: number;
  /** Срок прошёл, а долг остался */
  is_overdue: boolean;
}

/**
 * Регулярное внесение: выплата агрегатора за вычетом его процента.
 *
 * Хранится сумма ДО удержания и доля комиссии, потому что именно так оно и
 * происходит: агрегатор считаетgross, удерживает своё и переводит остаток.
 */
export interface RecurringIncomeItem {
  id: number;
  title: string;
  category_id: number;
  category_name: string;
  category_color?: string | null;
  amount: number;
  /** Доля удержания: 0.25 = 25% */
  commission: number;
  /** Сколько придёт на руки: amount * (1 - commission) */
  net: number;
  frequency: RecurringFrequency;
  next_date: string;
  is_active: number;
}

export interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  /** Процент загрузки 0–100 */
  percent?: number;
  version?: string;
  message?: string;
  /** Можно ли обновиться прямо сейчас на этой платформе */
  canInstall: boolean;
  downloadUrl?: string;
  releaseUrl?: string;
  /** Поддерживается ли автообновление на этой платформе */
  supported?: boolean;
}

export interface CategoryBreakdown {
  total: number;
  /** Цвет категории, выбранный пользователем */
  color: string | null;
  subcategories: Record<string, { total: number; items: Record<string, number> }>;
}

export interface Report {
  /** Остаток на начало периода (отметка + операции после неё) */
  startBalance: number;
  /** Деньги на выходе: после всех внесений и вычетов */
  endBalance: number;
  totalExpenses: number;
  totalDeposits: number;
  /** Пришло по займам за период. Не доход: деньги чужие */
  loanTaken: number;
  /** Возвращено по займам за период. Не расход: деньги те же самые */
  loanRepaid: number;
  /** Долг по всем займам на сейчас */
  openLoanDebt: number;
  /** Займы, попавшие в период или ещё не закрытые */
  loans: LoanItem[];
  /** Отметка «Указать остаток», на которую опирается расчёт */
  baseCheckpoint: { amount: number; date: string | null };
  expenses: Expense[];
  deposits: Deposit[];
  byCategory: Record<string, CategoryBreakdown>;
  /** Внесения, сгруппированные по категориям внесений */
  byDepositCategory: Record<string, { total: number; color: string | null }>;
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
  /** Подпись кнопки в тосте, например «Отменить» при удалении траты */
  actionLabel?: string;
  /** Вызывается по нажатию кнопки; после вызова тост скрывается */
  onAction?: () => void;
  /**
   * Сколько миллисекунд тост живёт сам, без действия.
   * Для тостов с кнопкой отмены время увеличено, чтобы успеть нажать.
   */
  duration?: number;
}