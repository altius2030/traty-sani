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
import { buildChartCsv } from './components/ReportCharts';
import { depositColorMap, expenseColorMap } from './lib/reportColors';
import ToastContainer from './components/ToastContainer';
import type {
  DepositCategory,
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
  getPeriodLabel,
  getPresetPeriod,
  parseCategoriesSubcategories,
} from './lib/format';

/** Текст подтверждения удаления: прямо говорим, сколько трат пропадёт */
function buildDeleteMessage(
  kind: 'category' | 'subcategory' | 'subitem',
  impact?: { expenses: number; subcategories: number; subitems?: number }
): string {
  const noun =
    kind === 'category'
      ? 'эту категорию'
      : kind === 'subcategory'
      ? 'эту подкатегорию'
      : 'эту статью';
  const parts: string[] = [];

  if (impact && impact.subcategories > 0) {
    parts.push(`${impact.subcategories} подкатегорий`);
  }
  if (impact && impact.subitems && impact.subitems > 0) {
    parts.push(`${impact.subitems} статей`);
  }
  if (impact && impact.expenses > 0) {
    parts.push(`${impact.expenses} трат`);
  }

  if (parts.length === 0) {
    return `Вы уверены, что хотите удалить ${noun}?`;
  }
  return `Удалить ${noun}? Вместе с ней будут удалены: ${parts.join(' и ')}. Отменить это действие нельзя.`;
}

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositCategories, setDepositCategories] = useState<DepositCategory[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [baseCheckpoint, setBaseCheckpoint] = useState<{
    amount: number;
    date: string | null;
  }>({ amount: 0, date: null });
  const [period, setPeriod] = useState<Period>(getPresetPeriod('month'));
  const [activeTab, setActiveTab] = useState<MainTab>('expenses');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<number | null>(null);
  const [selectedSubitemId, setSelectedSubitemId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<
    | { type: 'expense'; categoryId?: number; subcategoryId?: number; subitemId?: number }
    | { type: 'deposit' }
    | { type: 'balance' }
    | { type: 'categories' }
    | { type: 'report' }
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | {
        kind: 'expense' | 'deposit' | 'category' | 'subcategory' | 'subitem';
        id: number;
        impact?: { expenses: number; subcategories: number; subitems?: number };
      }
    | null
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

  const loadDepositCategories = useCallback(async () => {
    const list = await window.electronAPI.getDepositCategories();
    setDepositCategories(list);
    return list;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([
          loadCategories(),
          loadExpenses(period),
          loadBalances(),
          loadDepositCategories(),
        ]);
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
    subitemId?: number;
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

  const handleAddDeposit = async (data: { amount: number; date: string; categoryId: number }) => {
    try {
      const saved = await window.electronAPI.addDeposit(data);
      setModal(null);
      const label = saved?.category_name ? ` — ${saved.category_name}` : '';
      addToast(`Внесено ${formatMoney(data.amount)}${label}`);
      await Promise.all([loadExpenses(period), loadBalances()]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось сохранить внесение';
      addToast(message, 'error');
    }
  };

  /** Создание категории внесения; возвращает её, чтобы форма сразу выбрала */
  const handleAddDepositCategory = async (name: string) => {
    try {
      const created = await window.electronAPI.addDepositCategory(name);
      await loadDepositCategories();
      return created;
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Не удалось создать категорию',
        'error'
      );
      throw err;
    }
  };

  /** Удаление категории внесения не трогает сами внесения — пропадает только метка */
  const handleDeleteDepositCategory = async (id: number) => {
    const cat = depositCategories.find((c) => c.id === id);
    const count = cat?.deposits_count ?? 0;
    try {
      await window.electronAPI.deleteDepositCategory(id);
      addToast(
        count > 0
          ? `Категория удалена. ${count} внес. осталось без категории`
          : 'Категория удалена',
        'info'
      );
      await Promise.all([loadDepositCategories(), loadExpenses(period)]);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Не удалось удалить категорию',
        'error'
      );
    }
  };

  const handleDeleteExpense = (id: number) => {
    setConfirmDelete({ kind: 'expense', id });
  };

  const handleDeleteDeposit = (id: number) => {
    setConfirmDelete({ kind: 'deposit', id });
  };

  /** Считаем, сколько трат и подкатегорий исчезнет вместе с удалением */
  const askDelete = async (kind: 'category' | 'subcategory', id: number) => {
    const impact = await window.electronAPI.getDeleteImpact(kind, id);
    setConfirmDelete({ kind, id, impact });
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
    } else if (kind === 'subitem') {
      await window.electronAPI.deleteSubitem(id);
      addToast('Статья удалена', 'info');
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

  const handleSetIcon = async (id: number, icon: string | null) => {
    await window.electronAPI.setCategoryIcon(id, icon);
    await loadCategories();
  };

  const handleSetColor = async (id: number, color: string | null) => {
    await window.electronAPI.setCategoryColor(id, color);
    await loadCategories();
  };

  const handleAddSubitem = async (subcategoryId: number, name: string) => {
    try {
      await window.electronAPI.addSubitem(subcategoryId, name);
      await loadCategories();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Не удалось добавить статью', 'error');
    }
  };

  const askDeleteSubitem = async (id: number) => {
    const impact = await window.electronAPI.getDeleteImpact('subitem', id);
    setConfirmDelete({ kind: 'subitem', id, impact });
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

  const handleMakeBackup = async () => {
    try {
      const res = await window.electronAPI.makeBackup();
      addToast(`Копия сохранена: ${res.path.split(/[\\/]/).pop()}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Не удалось создать копию', 'error');
    }
  };

  const handleSelectCategory = (id: number) => {
    setSelectedCategoryId(id);
    setSelectedSubcategoryId(null);
    setSelectedSubitemId(null);
  };

  const handleSelectSubcategory = (id: number | null) => {
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
    lines.push('Дата;Сумма;Категория');
    for (const d of rep.deposits) {
      const cat = (d.category_name || 'Без категории').replace(/;/g, ',');
      lines.push(`${d.date};${d.amount.toFixed(2)};${cat}`);
    }
    lines.push('');
    lines.push('Внесения по категориям:');
    lines.push('Категория;Сумма');
    for (const [cat, data] of Object.entries(rep.byDepositCategory || {})) {
      lines.push(`${cat.replace(/;/g, ',')};${data.total.toFixed(2)}`);
    }
    lines.push('');
    lines.push('Расходы по категориям:');
    lines.push('Категория;Подкатегория;Статья;Сумма');
    for (const [cat, data] of Object.entries(rep.byCategory)) {
      lines.push(`${cat};;${data.total.toFixed(2)}`);
      for (const [sub, subData] of Object.entries(data.subcategories)) {
        lines.push(`${cat};${sub};${subData.total.toFixed(2)}`);
        for (const [item, itemTotal] of Object.entries(subData.items)) {
          lines.push(`${cat};${sub};${item};${itemTotal.toFixed(2)}`);
        }
      }
    }
    lines.push('');
    lines.push('Детальный список трат:');
    lines.push('Дата;Категория;Подкатегория;Статья;Сумма;Комментарий');
    for (const exp of rep.expenses) {
      const cat = exp.category_name.replace(/;/g, ',');
      const sub = (exp.subcategory_name || '').replace(/;/g, ',');
      const item = (exp.subitem_name || '').replace(/;/g, ',');
      const note = (exp.note || '').replace(/;/g, ',');
      lines.push(`${exp.date};${cat};${sub};${item};${exp.amount.toFixed(2)};${note}`);
    }

    // Данные, на которых построены графики, — отдельными секциями
    lines.push(...buildChartCsv(rep));

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

  // ——— Экспорт в Excel с нативными графиками ———
  const handleExportXlsx = async (rep: Report, p: Period) => {
    try {
      const byDayMap = new Map<string, { label: string; expense: number; deposit: number }>();
      for (const e of rep.expenses) {
        const label = new Date(e.date).toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
        });
        const cur = byDayMap.get(e.date) || { label, expense: 0, deposit: 0 };
        cur.expense += e.amount;
        byDayMap.set(e.date, cur);
      }
      for (const d of rep.deposits) {
        const label = new Date(d.date).toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
        });
        const cur = byDayMap.get(d.date) || { label, expense: 0, deposit: 0 };
        cur.deposit += d.amount;
        byDayMap.set(d.date, cur);
      }

      // Цвета для графиков Excel — те же, что в интерфейсе. Иначе категории без
      // выбранного цвета попали бы в файл серым, хотя на кольце отчёта они
      // окрашены палитрой.
      const expenseColors = expenseColorMap(rep);
      const depositColors = depositColorMap(rep);

      const result = await window.electronAPI.exportReportXlsx({
        title: `Отчёт: ${getPeriodLabel(p)}`,
        period: `${p.startDate} — ${p.endDate}`,
        startBalance: rep.startBalance,
        totalDeposits: rep.totalDeposits,
        totalExpenses: rep.totalExpenses,
        endBalance: rep.endBalance,
        checkpoint: rep.baseCheckpoint,
        expenseRows: rep.expenses.map((e) => ({
          date: e.date,
          category: e.category_name,
          subcategory: e.subcategory_name || '',
          item: e.subitem_name || '',
          amount: e.amount,
          note: e.note || '',
        })),
        depositRows: rep.deposits.map((d) => ({
          date: d.date,
          category: d.category_name || 'Без категории',
          amount: d.amount,
        })),
        expenseByCategory: Object.entries(rep.byCategory).map(([name, data]) => ({
          name,
          total: data.total,
          color: expenseColors[name],
        })),
        depositByCategory: Object.entries(rep.byDepositCategory || {}).map(
          ([name, data]) => ({ name, total: data.total, color: depositColors[name] })
        ),
        byDay: [...byDayMap.values()].sort((a, b) => (a.label < b.label ? -1 : 1)),
      });

      if (result.success) addToast('Отчёт сохранён в Excel');
      else if (result.path) addToast('Отчёт сохранён');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Не удалось сохранить отчёт в Excel',
        'error'
      );
    }
  };

  /** Смена цвета категории внесения — влияет на кольцо прихода и на Excel */
  const handleSetDepositColor = async (id: number, color: string | null) => {
    await window.electronAPI.setDepositCategoryColor(id, color);
    await loadDepositCategories();
  };

  // ——— Рендер ———
  return (
    <div className="app" data-platform={window.electronAPI.platform}>
      {/* Панель заголовка: перетаскивание окна + отступ под системные кнопки */}
      <div className="drag-region">
        <span className="drag-region-title">
          Траты Сани <span className="drag-region-version">v{__APP_VERSION__}</span>
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          selectedSubcategoryId={selectedSubcategoryId}
          selectedSubitemId={selectedSubitemId}
          currentBalance={currentBalance}
          baseCheckpoint={baseCheckpoint}
          onSelectCategory={handleSelectCategory}
          onSelectSubcategory={handleSelectSubcategory}
          onSelectSubitem={setSelectedSubitemId}
          onDeleteSubitem={askDeleteSubitem}
          onAddExpense={(categoryId, subcategoryId, subitemId) =>
            setModal({ type: 'expense', categoryId, subcategoryId, subitemId })
          }
          onOpenCategoryManager={() => setModal({ type: 'categories' })}
          onOpenBalance={() => setModal({ type: 'balance' })}
          onMakeBackup={handleMakeBackup}
          onDeleteCategory={(id) => askDelete('category', id)}
          onDeleteSubcategory={(id) => askDelete('subcategory', id)}
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
          preselectedSubcategoryId={modal.subcategoryId}
          preselectedSubitemId={modal.subitemId}
          onClose={() => setModal(null)}
          onSubmit={handleAddExpense}
        />
      )}

      {modal?.type === 'deposit' && (
        <AddDepositModal
          depositCategories={depositCategories}
          onClose={() => setModal(null)}
          onSubmit={handleAddDeposit}
          onAddCategory={handleAddDepositCategory}
        />
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
          onDeleteCategory={(id) => askDelete('category', id)}
          onDeleteSubcategory={(id) => askDelete('subcategory', id)}
          onSetIcon={handleSetIcon}
          onSetColor={handleSetColor}
          onAddSubitem={handleAddSubitem}
          onDeleteSubitem={askDeleteSubitem}
          depositCategories={depositCategories}
          onAddDepositCategory={handleAddDepositCategory}
          onDeleteDepositCategory={handleDeleteDepositCategory}
          onSetDepositColor={handleSetDepositColor}
        />
      )}

      {modal?.type === 'report' && (
        <ReportModal
          period={period}
          onClose={() => setModal(null)}
          onExport={handleExport}
          onExportXlsx={handleExportXlsx}
        />
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
              ? buildDeleteMessage('category', confirmDelete.impact)
              : confirmDelete.kind === 'subcategory'
              ? buildDeleteMessage('subcategory', confirmDelete.impact)
              : buildDeleteMessage('subitem', confirmDelete.impact)
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