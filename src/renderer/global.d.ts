export interface ElectronAPI {
  /** 'win32' | 'darwin' | 'linux' */
  readonly platform: string;
  getCategories(): Promise<any[]>;
  addCategory(name: string): Promise<{ id: number; name: string; is_custom: number }>;
  addSubcategory(
    categoryId: number,
    name: string
  ): Promise<{ id: number; name: string; is_custom: number }>;
  deleteCategory(id: number): Promise<{ success: boolean }>;
  deleteSubcategory(id: number): Promise<{ success: boolean }>;
  getExpenses(startDate: string, endDate: string): Promise<any[]>;
  addExpense(expense: {
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    date: string;
    note?: string;
  }): Promise<any>;
  deleteExpense(id: number): Promise<{ success: boolean }>;
  getBalanceHistory(): Promise<any[]>;
  getCurrentBalance(): Promise<{ balance: number; base: number; baseDate: string | null }>;
  addBalance(balance: {
    amount: number;
    date: string;
    note?: string;
  }): Promise<any>;
  deleteBalance(id: number): Promise<{ success: boolean }>;
  getDeposits(startDate: string, endDate: string): Promise<any[]>;
  addDeposit(deposit: { amount: number; date: string; note: string }): Promise<any>;
  deleteDeposit(id: number): Promise<{ success: boolean }>;
  getReport(startDate: string, endDate: string): Promise<any>;
  saveFile(
    defaultPath: string,
    content: string
  ): Promise<{ success: boolean; path?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}