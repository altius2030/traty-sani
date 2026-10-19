import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /** 'win32' | 'darwin' | 'linux' — используется для адаптации оформления */
  platform: (() => {
    const arg = process.argv.find((a) => a.startsWith('--app-platform='));
    return arg ? arg.split('=')[1] : process.platform;
  })(),

  getCategories: () => ipcRenderer.invoke('db:getCategories'),
  addCategory: (name: string) => ipcRenderer.invoke('db:addCategory', name),
  addSubcategory: (categoryId: number, name: string) => ipcRenderer.invoke('db:addSubcategory', categoryId, name),
  setCategoryIcon: (id: number, icon: string | null) => ipcRenderer.invoke('db:setCategoryIcon', id, icon),
  setCategoryColor: (id: number, color: string | null) => ipcRenderer.invoke('db:setCategoryColor', id, color),
  addSubitem: (subcategoryId: number, name: string) => ipcRenderer.invoke('db:addSubitem', subcategoryId, name),
  deleteSubitem: (id: number) => ipcRenderer.invoke('db:deleteSubitem', id),
  deleteCategory: (id: number) => ipcRenderer.invoke('db:deleteCategory', id),
  deleteSubcategory: (id: number) => ipcRenderer.invoke('db:deleteSubcategory', id),
  mergeCategories: (payload: { targetId: number; sourceIds: number[] }) =>
    ipcRenderer.invoke('db:mergeCategories', payload),
  renameCategory: (id: number, name: string) => ipcRenderer.invoke('db:renameCategory', id, name),
  renameSubcategory: (id: number, name: string) => ipcRenderer.invoke('db:renameSubcategory', id, name),
  renameSubitem: (id: number, name: string) => ipcRenderer.invoke('db:renameSubitem', id, name),

  makeBackup: () => ipcRenderer.invoke('db:makeBackup'),
  getBackups: () => ipcRenderer.invoke('db:getBackups'),
  getDeleteImpact: (kind: 'category' | 'subcategory', id: number) =>
    ipcRenderer.invoke('db:getDeleteImpact', kind, id),
  
  getExpenses: (startDate: string, endDate: string, accountId?: number | null) =>
    ipcRenderer.invoke('db:getExpenses', { startDate, endDate, accountId }),
  addExpense: (expense: { categoryId: number; subcategoryId?: number; amount: number; date: string; note?: string }) => 
    ipcRenderer.invoke('db:addExpense', expense),
  deleteExpense: (id: number) => ipcRenderer.invoke('db:deleteExpense', id),
  // Возврат удалённой записи для отмены удаления
  restoreExpense: (expense: unknown) => ipcRenderer.invoke('db:restoreExpense', expense),
  restoreDeposit: (deposit: unknown) => ipcRenderer.invoke('db:restoreDeposit', deposit),

  // ——— Регулярные платежи ———
  getDueRecurring: () => ipcRenderer.invoke('db:getDueRecurring'),
  getRecurring: () => ipcRenderer.invoke('db:getRecurring'),
  getRecurringCalendar: (range: unknown) => ipcRenderer.invoke('db:getRecurringCalendar', range),
  addRecurring: (p: unknown) => ipcRenderer.invoke('db:addRecurring', p),
  updateRecurring: (id: number, patch: unknown) =>
    ipcRenderer.invoke('db:updateRecurring', id, patch),
  deleteRecurring: (id: number) => ipcRenderer.invoke('db:deleteRecurring', id),
  payRecurring: (id: number, accountId?: number) =>
    ipcRenderer.invoke('db:payRecurring', id, accountId),
  getRecurringMonthlyTotal: () => ipcRenderer.invoke('db:getRecurringMonthlyTotal'),
  
  getBalanceHistory: () => ipcRenderer.invoke('db:getBalanceHistory'),
  getCurrentBalance: () => ipcRenderer.invoke('db:getCurrentBalance'),
  addBalance: (balance: { amount: number; date: string; note?: string }) => 
    ipcRenderer.invoke('db:addBalance', balance),
  deleteBalance: (id: number) => ipcRenderer.invoke('db:deleteBalance', id),

  getDeposits: (startDate: string, endDate: string, accountId?: number | null) =>
    ipcRenderer.invoke('db:getDeposits', { startDate, endDate, accountId }),
  addDeposit: (deposit: { amount: number; date: string; categoryId: number }) =>
    ipcRenderer.invoke('db:addDeposit', deposit),
  deleteDeposit: (id: number) => ipcRenderer.invoke('db:deleteDeposit', id),
  getDepositCategories: () => ipcRenderer.invoke('db:getDepositCategories'),
  addDepositCategory: (name: string) => ipcRenderer.invoke('db:addDepositCategory', name),
  deleteDepositCategory: (id: number) => ipcRenderer.invoke('db:deleteDepositCategory', id),
  renameDepositCategory: (id: number, name: string) => ipcRenderer.invoke('db:renameDepositCategory', id, name),
  setDepositCategoryColor: (id: number, color: string | null) =>
    ipcRenderer.invoke('db:setDepositCategoryColor', id, color),
  exportReportXlsx: (payload: any) => ipcRenderer.invoke('report:exportXlsx', payload),

  // Счета и перемещения между ними
  getAccountBalances: () => ipcRenderer.invoke('db:getAccountBalances'),
  addAccount: (account: { name: string; kind?: string; color?: string | null }) =>
    ipcRenderer.invoke('db:addAccount', account),
  renameAccount: (id: number, name: string) => ipcRenderer.invoke('db:renameAccount', id, name),
  setAccountColor: (id: number, color: string | null) =>
    ipcRenderer.invoke('db:setAccountColor', id, color),
  deleteAccount: (id: number) => ipcRenderer.invoke('db:deleteAccount', id),
  getTransfers: (range: { startDate: string; endDate: string }) =>
    ipcRenderer.invoke('db:getTransfers', range),
  addTransfer: (transfer: {
    fromAccountId: number;
    toAccountId: number;
    amount: number;
    date: string;
    note?: string;
  }) => ipcRenderer.invoke('db:addTransfer', transfer),
  deleteTransfer: (id: number) => ipcRenderer.invoke('db:deleteTransfer', id),
  getMoneyMovements: (range: { startDate: string; endDate: string }) =>
    ipcRenderer.invoke('db:getMoneyMovements', range),

  // Займы: деньги пришли и ушли, но ни доходом, ни расходом не являются
  getLoans: () => ipcRenderer.invoke('db:getLoans'),
  addLoan: (loan: {
    title: string;
    source?: string;
    amount: number;
    dateTaken: string;
    dateDue: string;
    depositCategoryId?: number;
    accountId?: number;
    note?: string;
  }) => ipcRenderer.invoke('db:addLoan', loan),
  repayLoan: (loan: {
    id: number;
    amount: number;
    categoryId: number;
    date: string;
    accountId?: number;
  }) => ipcRenderer.invoke('db:repayLoan', loan),
  deleteLoan: (id: number) => ipcRenderer.invoke('db:deleteLoan', id),

  // Регулярные внесения: выплаты агрегаторов с удержанием процента
  getRecurringIncome: () => ipcRenderer.invoke('db:getRecurringIncome'),
  getDueRecurringIncome: () => ipcRenderer.invoke('db:getDueRecurringIncome'),
  addRecurringIncome: (item: {
    title: string;
    categoryId: number;
    amount: number;
    commissionPercent: number;
    frequency: string;
    nextDate: string;
    accountId?: number;
  }) => ipcRenderer.invoke('db:addRecurringIncome', item),
  updateRecurringIncome: (item: {
    id: number;
    title: string;
    categoryId: number;
    amount: number;
    commissionPercent: number;
    frequency: string;
    nextDate: string;
    accountId?: number;
  }) => ipcRenderer.invoke('db:updateRecurringIncome', item),
  toggleRecurringIncome: (id: number) => ipcRenderer.invoke('db:toggleRecurringIncome', id),
  deleteRecurringIncome: (id: number) => ipcRenderer.invoke('db:deleteRecurringIncome', id),
  receiveRecurringIncome: (id: number, p?: { actualAmount?: number; accountId?: number }) =>
    ipcRenderer.invoke('db:receiveRecurringIncome', id, p),
  getRecurringIncomeMonthlyTotal: () => ipcRenderer.invoke('db:getRecurringIncomeMonthlyTotal'),
  
  getReport: (startDate: string, endDate: string) => ipcRenderer.invoke('db:getReport', { startDate, endDate }),
  saveFile: (defaultPath: string, content: string) => ipcRenderer.invoke('dialog:saveFile', defaultPath, content),

  // ——— Обновление приложения ———
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  openReleasePage: () => ipcRenderer.invoke('update:openReleasePage'),
  // Главный процесс шлёт состояние обновления при каждом изменении
  onUpdateStatus: (cb: (status: any) => void) => {
    const listener = (_: unknown, status: unknown) => cb(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});

declare global {
  interface Window {
    electronAPI: {
      getCategories: () => Promise<any[]>;
      addCategory: (name: string) => Promise<{ id: number; name: string; is_custom: number }>;
      addSubcategory: (categoryId: number, name: string) => Promise<{ id: number; name: string; is_custom: number }>;
      deleteCategory: (id: number) => Promise<{ success: boolean }>;
      deleteSubcategory: (id: number) => Promise<{ success: boolean }>;
      getExpenses: (startDate: string, endDate: string) => Promise<any[]>;
      addExpense: (expense: { categoryId: number; subcategoryId?: number; amount: number; date: string; note?: string }) => Promise<any>;
      deleteExpense: (id: number) => Promise<{ success: boolean }>;
      getBalanceHistory: () => Promise<any[]>;
      addBalance: (balance: { amount: number; date: string; note?: string }) => Promise<any>;
      deleteBalance: (id: number) => Promise<{ success: boolean }>;
      getReport: (startDate: string, endDate: string) => Promise<any>;
      saveFile: (defaultPath: string, content: string) => Promise<{ success: boolean; path?: string }>;
    };
  }
}