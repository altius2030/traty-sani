import { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import ExpenseTable from './components/ExpenseTable';
import AddExpenseModal, {
  AddBalanceModal,
  AddDepositModal,
  CategoryManagerModal,
  ConfirmModal,
} from './components/Modals';
import ReportModal from './components/ReportModal';
import ToastContainer from './components/ToastContainer';
import type {
  Category,
  Deposit,
  Expense,
  Period,
  PeriodPreset,
  Report,
  Toast,
  ToastType,
} from './types';
import type { MainTab } from './components/ExpenseTable';
import {
  formatMoney,
  getPresetPeriod,
  parseCategoriesSubcategories,
} from './lib/format';

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [baseCheckpoint, setBaseCheckpoint] = useState<{
    amount: number;
    date: string | null;
  }>({ amount: 0, date: null });
  const [period, setPeriod] = useState<Period>(getPresetPeriod('month'));
  const [activeTab, setActiveTab] = useState<MainTab>('expenses');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<
    | { type: 'expense'; categoryId?: number; subcategoryId?: number }
    | { type: 'deposit' }
    | { type: 'balance' }
    | { type: 'categories' }
    | { type: 'report' }
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: 'expense' | 'deposit' | 'category' | 'subcategory'; id: number } | null
  >(null);

  // ——— Уведомления ———
  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // ——— Загрузка данных ———
  const loadCategories = useCallback(async () => {
    const data = await window.electronAPI.getCategories();
    const normalized = data.map((c: any) => ({
      ...c,
      subcategories: parseCategoriesSubcategories(c.subcategories),
    }));
    setCategories(normalized);
    return normalized;
  }, []);

  const loadExpenses = useCallback(async (p: Period) => {
    const [expenseData, depositData] = await Promise.all([
      window.electronAPI.getExpenses(p.startDate, p.endDate),
      window.electronAPI.getDeposits(p.startDate, p.endDate),
    ]);
    setExpenses(expenseData);
    setDeposits(depositData);
    setLoading(false);
  }, []);

  const loadBalances = useCallback(async () => {
    const balance = await window.electronAPI.getCurrentBalance();
    setCurrentBalance(balance.balance);
    setBaseCheckpoint({ amount: balance.base, date: balance.baseDate });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadCategories(), loadExpenses(period), loadBalances()]);
      } catch (err) {
        console.error('Ошибка загрузки:', err);
        addToast('Ошибка при загрузке данных', 'error');
        setLoading(false);
      }
    })();
  }, [loadCategories, loadExpenses, loadBalances]);

  useEffect(() => {
    loadExpenses(period).catch(() => {});
  }, [period, loadExpenses]);

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );

  const totalDeposits = useMemo(
    () => deposits.reduce((sum, d) => sum + d.amount, 0),
    [deposits]
  );

  // ——— Действия ———
  const handlePeriodChange = (preset: PeriodPreset) => {
    setPeriod(getPresetPeriod(preset));
  };

  const handleCustomStartChange = (date: string) => {
    setPeriod((prev) => ({ ...prev, preset: 'custom', startDate: date }));
  };

  const handleCustomEndChange = (date: string) => {
    setPeriod((prev) => ({ ...prev, preset: 'custom', endDate: date }));
  };

  const handleAddExpense = async (data: {
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    date: string;
    note?: string;
  }) => {
    await window.electronAPI.addExpense(data);
    setModal(null);
    addToast(`Трата ${formatMoney(data.amount)} добавлена`);
    await Promise.all([loadExpenses(period), loadBalances()]);
  };

  const handleAddBalance = async (data: { amount: number; date: string; note?: string }) => {
    await window.electronAPI.addBalance(data);
    setModal(null);
    addToast(`Остаток ${formatMoney(data.amount)} сохранён`);
    await loadBalances();
  };

  const handleAddDeposit = async (data: { amount: number; date: string; note: string }) => {
    try {
      await window.electronAPI.addDeposit(data);
      setModal(null);
      addToast(`Внесено ${formatMoney(data.amount)}`);
      await Promise.all([loadExpenses(period), loadBalances()]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось сохранить внесение';
      addToast(message, 'error');
    }
  };

  const handleDeleteExpense = (id: number) => {
    setConfirmDelete({ kind: 'expense', id });
  };

  const handleDeleteDeposit = (id: number) => {
    setConfirmDelete({ kind: 'deposit', id });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const { kind, id } = confirmDelete;
    setConfirmDelete(null);

    if (kind === 'expense') {
      await window.electronAPI.deleteExpense(id);
      addToast('Трата удалена', 'info');
      await Promise.all([loadExpenses(period), loadBalances()]);
    } else if (kind === 'deposit') {
      await window.electronAPI.deleteDeposit(id);
      addToast('Внесение удалено', 'info');
      await Promise.all([loadExpenses(period), loadBalances()]);
    } else if (kind === 'category') {
      await window.electronAPI.deleteCategory(id);
      addToast('Категория удалена', 'info');
      await loadCategories();
    } else if (kind === 'subcategory') {
      await window.electronAPI.deleteSubcategory(id);
      addToast('Подкатегория удалена', 'info');
      await loadCategories();
    }
  };

  const handleAddCategory = async (name: string) => {
    try {
      await window.electronAPI.addCategory(name);
      addToast(`Категория «${name}» добавлена`);
      await loadCategories();
    } catch (err) {
      // Раньше здесь всегда показывался текст про дубликат, из-за чего
      // реальная причина ошибки была скрыта.
      const raw = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed: categories\.name/i.test(raw)) {
        addToast(`Категория «${name}» уже существует`, 'error');
      } else {
        addToast(`Не удалось создать категорию: ${raw}`, 'error');
      }
    }
  };

  const handleAddSubcategory = async (categoryId: number, name: string) => {
    try {
      await window.electronAPI.addSubcategory(categoryId, name);
      addToast(`Подкатегория «${name}» добавлена`);
      await loadCategories();
    } catch (err: any) {
      addToast('Ошибка при добавлении подкатегории', 'error');
    }
  };

  const handleSelectCategory = (id: number) => {
    setSelectedCategoryId(id);
    setSelectedSubcategoryId(null);
  };

  const handleSelectSubcategory = (id: number) => {
    setSelectedSubcategoryId(id);
  };

  // Отчёт загружается внутри ReportModal, здесь только открываем окно
  const handleOpenReport = () => {
    setModal({ type: 'report' });
  };

  const handleExport = async (rep: Report, p: Period) => {
    const lines: string[] = [];
    lines.push('Отчёт по расходам');
    lines.push(`Период: ${p.startDate} — ${p.endDate}`);
    lines.push('');
    lines.push(`На начало периода: ${rep.startBalance.toFixed(2)} ₸`);
    lines.push(`Внесения за период: ${rep.totalDeposits.toFixed(2)} ₸`);
    lines.push(`Траты за период: ${rep.totalExpenses.toFixed(2)} ₸`);
    lines.push(`На выходе: ${rep.endBalance.toFixed(2)} ₸`);
    if (rep.baseCheckpoint?.date) {
      lines.push(
        `Базовая отметка остатка: ${rep.baseCheckpoint.amount.toFixed(2)} ₸ от ${rep.baseCheckpoint.date}`
      );
    }

    lines.push('');
    lines.push('Внесения:');
    lines.push('Дата;Сумма;Комментарий');
    for (const d of rep.deposits) {
      const note = d.note.replace(/;/g, ',');
      lines.push(`${d.date};${d.amount.toFixed(2)};${note}`);
    }
    lines.push('');
    lines.push('Расходы по категориям:');
    lines.push('Категория;Подкатегория;Сумма');
    for (const [cat, data] of Object.entries(rep.byCategory)) {
      lines.push(`${cat};;${data.total.toFixed(2)}`);
      for (const [sub, subTotal] of Object.entries(data.subcategories)) {
        lines.push(`${cat};${sub};${subTotal.toFixed(2)}`);
      }
    }
    lines.push('');
    lines.push('Детальный список трат:');
    lines.push('Дата;Категория;Подкатегория;Сумма;Комментарий');
    for (const exp of rep.expenses) {
      const cat = exp.category_name.replace(/;/g, ',');
      const sub = (exp.subcategory_name || '').replace(/;/g, ',');
      const note = (exp.note || '').replace(/;/g, ',');
      lines.push(`${exp.date};${cat};${sub};${exp.amount.toFixed(2)};${note}`);
    }

    const content = '\uFEFF' + lines.join('\n');
    const filename = `otchet_${p.startDate}_${p.endDate}.csv`;

    if (window.electronAPI.saveFile) {
      const result = await window.electronAPI.saveFile(filename, content);
      if (result.success) {
        addToast('Отчёт сохранён');
        setModal(null);
      }
    } else {
      // Fallback для браузера
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Отчёт скачан');
    }
  };

  // ——— Рендер ———
  return (
    <div className="app" data-platform={window.electronAPI.platform}>
      {/* Панель заголовка: перетаскивание окна + отступ под системные кнопки */}
      <div className="drag-region">
        <span className="drag-region-title">Траты Сани</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          selectedSubcategoryId={selectedSubcategoryId}
          currentBalance={currentBalance}
          baseCheckpoint={baseCheckpoint}
          onSelectCategory={handleSelectCategory}
          onSelectSubcategory={handleSelectSubcategory}
          onAddExpense={(categoryId, subcategoryId) =>
            setModal({ type: 'expense', categoryId, subcategoryId })
          }
          onOpenCategoryManager={() => setModal({ type: 'categories' })}
          onOpenBalance={() => setModal({ type: 'balance' })}
          onDeleteCategory={(id) => setConfirmDelete({ kind: 'category', id })}
          onDeleteSubcategory={(id) => setConfirmDelete({ kind: 'subcategory', id })}
        />

        <ExpenseTable
          activeTab={activeTab}
          expenses={expenses}
          deposits={deposits}
          period={period}
          totalExpenses={totalExpenses}
          totalDeposits={totalDeposits}
          loading={loading}
          onTabChange={setActiveTab}
          onPeriodChange={handlePeriodChange}
          onCustomStartChange={handleCustomStartChange}
          onCustomEndChange={handleCustomEndChange}
          onDeleteExpense={handleDeleteExpense}
          onDeleteDeposit={handleDeleteDeposit}
          onAddExpense={() => setModal({ type: 'expense' })}
          onAddDeposit={() => setModal({ type: 'deposit' })}
          onOpenReport={handleOpenReport}
        />
      </div>

      {/* Модальные окна */}
      {modal?.type === 'expense' && (
        <AddExpenseModal
          categories={categories}
          preselectedCategoryId={modal.categoryId}
          onClose={() => setModal(null)}
          onSubmit={handleAddExpense}
        />
      )}

      {modal?.type === 'deposit' && (
        <AddDepositModal onClose={() => setModal(null)} onSubmit={handleAddDeposit} />
      )}

      {modal?.type === 'balance' && (
        <AddBalanceModal onClose={() => setModal(null)} onSubmit={handleAddBalance} />
      )}

      {modal?.type === 'categories' && (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setModal(null)}
          onAddCategory={handleAddCategory}
          onAddSubcategory={handleAddSubcategory}
          onDeleteCategory={(id) => setConfirmDelete({ kind: 'category', id })}
          onDeleteSubcategory={(id) => setConfirmDelete({ kind: 'subcategory', id })}
        />
      )}

      {modal?.type === 'report' && (
        <ReportModal period={period} onClose={() => setModal(null)} onExport={handleExport} />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Подтвердите удаление"
          message={
            confirmDelete.kind === 'expense'
              ? 'Вы уверены, что хотите удалить эту трату?'
              : confirmDelete.kind === 'deposit'
              ? 'Вы уверены, что хотите удалить это внесение?'
              : confirmDelete.kind === 'category'
              ? 'Вы уверены, что хотите удалить эту категорию? Все траты в ней останутся без категории.'
              : 'Вы уверены, что хотите удалить эту подкатегорию?'
          }
          confirmText="Удалить"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Уведомления */}
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

export default App;