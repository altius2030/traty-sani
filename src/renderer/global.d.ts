import type {
  DepositCategory,
  Expense,
  Deposit,
  RecurringItem,
  RecurringFrequency,
} from './types';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  percent?: number;
  transferred?: number;
  total?: number;
  version?: string;
  message?: string;
  /** Можно ли обновиться прямо сейчас на этой платформе */
  canInstall: boolean;
  downloadUrl?: string;
  /** Ссылка на страницу релиза, приходит из главного процесса */
  releaseUrl?: string;
  /** Поддерживается ли автообновление на этой платформе (важно для macOS) */
  supported?: boolean;
}

export interface ElectronAPI {
  /** 'win32' | 'darwin' | 'linux' */
  readonly platform: string;
  getCategories(): Promise<any[]>;
  addCategory(name: string): Promise<{ id: number; name: string; is_custom: number }>;
  addSubcategory(
    categoryId: number,
    name: string
  ): Promise<{ id: number; name: string; is_custom: number }>;
  setCategoryIcon(id: number, icon: string | null): Promise<{ success: boolean }>;
  setCategoryColor(id: number, color: string | null): Promise<{ success: boolean }>;
  addSubitem(subcategoryId: number, name: string): Promise<any>;
  deleteSubitem(id: number): Promise<{ success: boolean }>;
  deleteCategory(id: number): Promise<{ success: boolean }>;
  deleteSubcategory(id: number): Promise<{ success: boolean }>;
  makeBackup(): Promise<{ path: string }>;
  getBackups(): Promise<{ name: string; path: string; size: number }[]>;
  getDeleteImpact(
    kind: 'category' | 'subcategory' | 'subitem',
    id: number
  ): Promise<{ expenses: number; subcategories: number; subitems: number }>;
  getExpenses(startDate: string, endDate: string): Promise<any[]>;
  addExpense(expense: {
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    date: string;
    note?: string;
  }): Promise<any>;
  deleteExpense(id: number): Promise<{ success: boolean }>;
  /** Возвращает удалённую трату с прежним id — для отмены удаления */
  restoreExpense(expense: Expense): Promise<{ success: boolean }>;
  restoreDeposit(deposit: Deposit): Promise<{ success: boolean }>;

  // ——— Регулярные платежи ———
  getDueRecurring(): Promise<RecurringItem[]>;
  getRecurring(): Promise<RecurringItem[]>;
  addRecurring(p: {
    title: string;
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    frequency: RecurringFrequency;
    nextDate: string;
  }): Promise<{ success: boolean; id: number }>;
  updateRecurring(
    id: number,
    patch: Partial<{
      title: string;
      amount: number;
      frequency: RecurringFrequency;
      nextDate: string;
      isActive: boolean;
    }>
  ): Promise<{ success: boolean; message?: string }>;
  deleteRecurring(id: number): Promise<{ success: boolean }>;
  /** Создаёт трату и сдвигает платёж на следующий период */
  payRecurring(id: number): Promise<{
    success: boolean;
    message?: string;
    nextDate?: string;
    expenseDate?: string;
  }>;
  /** Сколько постоянных расходов выходит в среднем за месяц */
  getRecurringMonthlyTotal(): Promise<number>;
  getBalanceHistory(): Promise<any[]>;
  getCurrentBalance(): Promise<{ balance: number; base: number; baseDate: string | null }>;
  addBalance(balance: {
    amount: number;
    date: string;
    note?: string;
  }): Promise<any>;
  deleteBalance(id: number): Promise<{ success: boolean }>;
  getDeposits(startDate: string, endDate: string): Promise<any[]>;
  addDeposit(deposit: { amount: number; date: string; categoryId: number }): Promise<any>;
  deleteDeposit(id: number): Promise<{ success: boolean }>;
  getDepositCategories(): Promise<DepositCategory[]>;
  addDepositCategory(name: string): Promise<{ id: number; name: string }>;
  deleteDepositCategory(id: number): Promise<{ success: boolean }>;
  setDepositCategoryColor(id: number, color: string | null): Promise<{ success: boolean }>;
  exportReportXlsx(payload: any): Promise<{ success: boolean; path?: string }>;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<{ success: boolean; message?: string }>;
  getUpdateStatus(): Promise<UpdateStatus>;
  openReleasePage(): Promise<{ success: boolean }>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  getReport(startDate: string, endDate: string): Promise<any>;
  saveFile(
    defaultPath: string,
    content: string
  ): Promise<{ success: boolean; path?: string }>;
}

declare global {
  /** Версия приложения, подставляется на этапе сборки (см. vite.config.ts) */
  const __APP_VERSION__: string;

  interface Window {
    electronAPI: ElectronAPI;
  }
}