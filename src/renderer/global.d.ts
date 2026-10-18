import type {
  DepositCategory,
  Expense,
  Deposit,
  RecurringItem,
  RecurringFrequency,
  RecurringOccurrence,
  AccountBalance,
  TransferItem,
  MoneyMovement,
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
  /** Смена названия. Траты и суммы при этом не теряются: ссылки идут по id */
  renameCategory(id: number, name: string): Promise<{ success: boolean; name: string }>;
  renameSubcategory(id: number, name: string): Promise<{ success: boolean; name: string }>;
  renameSubitem(id: number, name: string): Promise<{ success: boolean; name: string }>;
  /** Объединение категорий: основная остаётся, остальные переезжают в неё */
  mergeCategories(payload: {
    targetId: number;
    sourceIds: number[];
  }): Promise<{
    success: boolean;
    targetName: string;
    movedSubcategories: number;
    mergedSubcategories: number;
    movedExpenses: number;
    movedRecurring: number;
  }>;
  makeBackup(): Promise<{ path: string }>;
  getBackups(): Promise<{ name: string; path: string; size: number }[]>;
  getDeleteImpact(
    kind: 'category' | 'subcategory' | 'subitem',
    id: number
  ): Promise<{
    expenses: number;
    subcategories: number;
    subitems: number;
    /** Регулярных платежей, которые удалятся вместе с категорией */
    recurring: number;
  }>;
  getExpenses(
    startDate: string,
    endDate: string,
    accountId?: number | null
  ): Promise<Expense[]>;
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
  /**
   * Даты платежей внутри месяца. Считается на сервере той же функцией
   * сдвига, что и кнопка «оплачено», поэтому календарь и реальные траты
   * не могут разойтись.
   */
  getRecurringCalendar(range: {
    startDate: string;
    endDate: string;
  }): Promise<RecurringOccurrence[]>;
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
  payRecurring(id: number, accountId?: number): Promise<{
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
  getDeposits(
    startDate: string,
    endDate: string,
    accountId?: number | null
  ): Promise<Deposit[]>;
  addDeposit(deposit: { amount: number; date: string; categoryId: number }): Promise<{
    id: number;
    amount: number;
    date: string;
    category_name: string;
    /** Заполнено, если запись раньше отметки остатка и в него не вошла */
    warning?: string | null;
  }>;
  deleteDeposit(id: number): Promise<{ success: boolean }>;
  getDepositCategories(): Promise<DepositCategory[]>;
  addDepositCategory(name: string): Promise<{ id: number; name: string }>;
  deleteDepositCategory(id: number): Promise<{ success: boolean; deletedDeposits: number }>;
  renameDepositCategory(id: number, name: string): Promise<{ success: boolean; name: string }>;
  setDepositCategoryColor(id: number, color: string | null): Promise<{ success: boolean }>;
  exportReportXlsx(payload: any): Promise<{ success: boolean; path?: string }>;

  /** Счета и перемещения между ними */
  getAccountBalances(): Promise<AccountBalance[]>;
  addAccount(account: {
    name: string;
    kind?: string;
    color?: string | null;
  }): Promise<{ id: number; name: string }>;
  renameAccount(id: number, name: string): Promise<{ success: boolean }>;
  setAccountColor(id: number, color: string | null): Promise<{ success: boolean }>;
  deleteAccount(id: number): Promise<{ success: boolean }>;
  getTransfers(range: { startDate: string; endDate: string }): Promise<TransferItem[]>;
  /** Переводы, выплаты агрегаторов и займы одним списком — деньги, которые
   *  двигаются, но не являются ни доходом, ни расходом */
  getMoneyMovements(range: { startDate: string; endDate: string }): Promise<{
    movements: MoneyMovement[];
    withheld: number;
    loanDebt: number;
    loanTaken: number;
    loanRepaid: number;
  }>;
  addTransfer(transfer: {
    fromAccountId: number;
    toAccountId: number;
    amount: number;
    date: string;
    note?: string;
  }): Promise<{ id: number }>;
  deleteTransfer(id: number): Promise<{ success: boolean }>;

  /** Займ: взятые деньги и возвраты не попадают в доходы и расходы */
  getLoans(): Promise<LoanItem[]>;
  addLoan(loan: {
    title: string;
    source?: string;
    amount: number;
    dateTaken: string;
    dateDue: string;
    depositCategoryId?: number;
    accountId?: number;
    note?: string;
  }): Promise<{ success: boolean; id: number; recordedDeposit: boolean }>;
  repayLoan(loan: {
    id: number;
    amount: number;
    categoryId: number;
    date: string;
    accountId?: number;
  }): Promise<{
    success: boolean;
    remaining: number;
  }>;
  deleteLoan(id: number): Promise<{
    success: boolean;
    deletedDeposits: number;
    deletedExpenses: number;
    depositSum: number;
  }>;

  /** Регулярные внесения: выплата агрегатора за вычетом процента */
  getRecurringIncome(): Promise<RecurringIncomeItem[]>;
  getDueRecurringIncome(): Promise<RecurringIncomeItem[]>;
  addRecurringIncome(item: {
    title: string;
    categoryId: number;
    amount: number;
    commissionPercent: number;
    frequency: RecurringFrequency;
    nextDate: string;
  }): Promise<{ id: number; net: number }>;
  updateRecurringIncome(item: {
    id: number;
    title: string;
    categoryId: number;
    amount: number;
    commissionPercent: number;
    frequency: RecurringFrequency;
    nextDate: string;
  }): Promise<{ success: boolean; net: number }>;
  toggleRecurringIncome(id: number): Promise<{ success: boolean }>;
  deleteRecurringIncome(id: number): Promise<{ success: boolean }>;
  receiveRecurringIncome(id: number, p?: {
    actualAmount?: number;
    accountId?: number;
  }): Promise<{
    success: boolean;
    net: number;
    /** Сколько удержал агрегатор в этой выплате */
    withheld: number;
    date: string;
    nextDate: string;
  }>;
  getRecurringIncomeMonthlyTotal(): Promise<number>;
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