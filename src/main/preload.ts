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

  makeBackup: () => ipcRenderer.invoke('db:makeBackup'),
  getBackups: () => ipcRenderer.invoke('db:getBackups'),
  getDeleteImpact: (kind: 'category' | 'subcategory', id: number) =>
    ipcRenderer.invoke('db:getDeleteImpact', kind, id),
  
  getExpenses: (startDate: string, endDate: string) => ipcRenderer.invoke('db:getExpenses', { startDate, endDate }),
  addExpense: (expense: { categoryId: number; subcategoryId?: number; amount: number; date: string; note?: string }) => 
    ipcRenderer.invoke('db:addExpense', expense),
  deleteExpense: (id: number) => ipcRenderer.invoke('db:deleteExpense', id),
  // Возврат удалённой записи для отмены удаления
  restoreExpense: (expense: unknown) => ipcRenderer.invoke('db:restoreExpense', expense),
  restoreDeposit: (deposit: unknown) => ipcRenderer.invoke('db:restoreDeposit', deposit),

  // ——— Регулярные платежи ———
  getDueRecurring: () => ipcRenderer.invoke('db:getDueRecurring'),
  getRecurring: () => ipcRenderer.invoke('db:getRecurring'),
  addRecurring: (p: unknown) => ipcRenderer.invoke('db:addRecurring', p),
  updateRecurring: (id: number, patch: unknown) =>
    ipcRenderer.invoke('db:updateRecurring', id, patch),
  deleteRecurring: (id: number) => ipcRenderer.invoke('db:deleteRecurring', id),
  payRecurring: (id: number) => ipcRenderer.invoke('db:payRecurring', id),
  getRecurringMonthlyTotal: () => ipcRenderer.invoke('db:getRecurringMonthlyTotal'),
  
  getBalanceHistory: () => ipcRenderer.invoke('db:getBalanceHistory'),
  getCurrentBalance: () => ipcRenderer.invoke('db:getCurrentBalance'),
  addBalance: (balance: { amount: number; date: string; note?: string }) => 
    ipcRenderer.invoke('db:addBalance', balance),
  deleteBalance: (id: number) => ipcRenderer.invoke('db:deleteBalance', id),

  getDeposits: (startDate: string, endDate: string) => ipcRenderer.invoke('db:getDeposits', { startDate, endDate }),
  addDeposit: (deposit: { amount: number; date: string; categoryId: number }) =>
    ipcRenderer.invoke('db:addDeposit', deposit),
  deleteDeposit: (id: number) => ipcRenderer.invoke('db:deleteDeposit', id),
  getDepositCategories: () => ipcRenderer.invoke('db:getDepositCategories'),
  addDepositCategory: (name: string) => ipcRenderer.invoke('db:addDepositCategory', name),
  deleteDepositCategory: (id: number) => ipcRenderer.invoke('db:deleteDepositCategory', id),
  setDepositCategoryColor: (id: number, color: string | null) =>
    ipcRenderer.invoke('db:setDepositCategoryColor', id, color),
  exportReportXlsx: (payload: any) => ipcRenderer.invoke('report:exportXlsx', payload),
  
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