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
  
  getReport: (startDate: string, endDate: string) => ipcRenderer.invoke('db:getReport', { startDate, endDate }),
  saveFile: (defaultPath: string, content: string) => ipcRenderer.invoke('dialog:saveFile', defaultPath, content),
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