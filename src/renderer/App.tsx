import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, Save, RefreshCw, Sun, Moon, Repeat } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ExpenseTable from './components/ExpenseTable';
import AddExpenseModal, {
  AddBalanceModal,
  AddDepositModal,
  CategoryManagerModal,
  ConfirmModal,
  UpdateModal,
} from './components/Modals';
import ReportModal from './components/ReportModal';
import { buildChartCsv } from './components/ReportCharts';
import { depositColorMap, expenseColorMap } from './lib/reportColors';
import ToastContainer from './components/ToastContainer';
import { RecurringModal } from './components/Recurring';
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
  UpdateStatus,
  RecurringItem,
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

export type Theme = 'dark' | 'light';

const THEME_KEY = 'traty-theme';

/**
 * Читает сохранённую тему.
 *
 * Тема ставится на <html> ещё до отрисовки React (скрипт в index.html),
 * иначе при запуске на секунду мелькала бы тёмная тема поверх светлой.
 * Здесь берём то же значение, что и скрипт, чтобы React не пересёкся с ним.
 */
function readStoredTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage может быть недоступен — тогда просто останется тёмная
  }
  return 'dark';
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
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    canInstall: true,
  });
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  // Фильтр таблицы. Хранится текстом, а не распарсенным числом: во время
  // набора поле не должно прыгать, а пустая строка — это «без ограничения»
  const [tableFilter, setTableFilter] = useState({ text: '', min: '', max: '' });
  const searchRef = useRef<HTMLInputElement>(null);

  // ——— Регулярные платежи ———
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [dueRecurring, setDueRecurring] = useState<RecurringItem[]>([]);
  const [recurringMonthly, setRecurringMonthly] = useState(0);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Не смогли сохранить — тема всё равно переключится в этой сессии
      }
      return next;
    });
  }, []);
  const [modal, setModal] = useState<
    | { type: 'expense'; categoryId?: number; subcategoryId?: number; subitemId?: number }
    | { type: 'deposit' }
    | { type: 'balance' }
    | { type: 'categories' }
    | { type: 'report' }
    | { type: 'update' }
    | { type: 'repeatExpense'; expense: Expense }
    | { type: 'repeatDeposit'; deposit: Deposit }
    | { type: 'recurring' }
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | {
        kind:
          | 'expense'
          | 'deposit'
          | 'category'
          | 'subcategory'
          | 'subitem'
          | 'recurring';
        id: number;
        impact?: { expenses: number; subcategories: number; subitems?: number };
        /** Название регулярного платежа — для понятного вопроса */
        title?: string;
      }
    | null
  >(null);

  // ——— Уведомления ———
  const addToast = useCallback(
    (message: string, type: ToastType = 'success', options?: { actionLabel?: string; onAction?: () => void; duration?: number }) => {
      const id = Date.now() + Math.random();
      // С кнопкой отмены живём дольше обычного: 4 секунды на нажатие
      // «Отменить» — слишком мало, действие терялось бы чаще, чем срабатывало
      const life = options?.duration ?? (options?.actionLabel ? 8000 : 4000);
      setToasts((prev) => [
        ...prev,
        { id, type, message, actionLabel: options?.actionLabel, onAction: options?.onAction },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, life);
    },
    []
  );

  /**
 * Загрузка регулярных платежей.
 *
 * Подтягиваются два списка: все (для окна настройки) и только наступившие
 * (для боковой панели). Сумма за месяц считается на сервере — там же
 * переводится «ежедневно» в месяц, иначе эти правила разошлись бы.
 */
const loadRecurring = useCallback(async () => {
    const [all, due, monthly] = await Promise.all([
      window.electronAPI.getRecurring(),
      window.electronAPI.getDueRecurring(),
      window.electronAPI.getRecurringMonthlyTotal(),
    ]);
    setRecurring(all);
    setDueRecurring(due);
    setRecurringMonthly(monthly);
  }, []);

  // Загрузка данных ———
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

  /**
   * Фильтрация выполняется в памяти: период уже загружен целиком, а
   * запрос к базе на каждый ввод буквы только тормозил бы.
   *
   * Итоги в шапке считаются по отфильтрованным данным — так сумма на
   * экране соответствует тому, что видно в таблице.
   */
  const matchesFilter = useCallback(
    (
      row: {
        amount: number;
        note?: string | null;
        category_name?: string | null;
        subcategory_name?: string | null;
        subitem_name?: string | null;
      },
      f: { text: string; min: string; max: string }
    ) => {
      const min = f.min === '' ? null : Number(f.min);
      const max = f.max === '' ? null : Number(f.max);
      if (min !== null && row.amount < min) return false;
      if (max !== null && row.amount > max) return false;

      const needle = f.text.trim().toLowerCase();
      if (needle === '') return true;

      // Пробел в запросе означает «любые слова в любом порядке»: пользователь
      // печатает «курт женское» и ждёт оба слова, а не точное совпадение
      const haystack = [row.note, row.category_name, row.subcategory_name, row.subitem_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      // Сумму тоже ищем: «500» находит трату на 500
      if (haystack.includes(needle)) return true;
      if (String(row.amount).includes(needle)) return true;
      return needle.split(/\s+/).every((word) => haystack.includes(word));
    },
    []
  );

  const visibleExpenses = useMemo(
    () => expenses.filter((e) => matchesFilter(e, tableFilter)),
    [expenses, tableFilter, matchesFilter]
  );

  const visibleDeposits = useMemo(
    () => deposits.filter((d) => matchesFilter(d, tableFilter)),
    [deposits, tableFilter, matchesFilter]
  );

  const hiddenCount =
    activeTab === 'expenses'
      ? expenses.length - visibleExpenses.length
      : deposits.length - visibleDeposits.length;

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
          loadRecurring(),
        ]);
      } catch (err) {
        console.error('Ошибка загрузки:', err);
        addToast('Ошибка при загрузке данных', 'error');
        setLoading(false);
      }
    })();
  }, [loadCategories, loadExpenses, loadBalances, loadRecurring]);

  useEffect(() => {
    loadExpenses(period).catch(() => {});
  }, [period, loadExpenses]);

  /**
 * Горячие клавиши.
 *
 * Ctrl+N — трата, Ctrl+D — внесение, Ctrl+F — поиск, Esc — закрыть окно.
 * Ctrl+N в браузере создаёт новое окно, поэтому его и перехватываем.
 *
 * Клавиши не срабатывают, если фокус в поле ввода и нажат букваный модификатор
 * с Shift: иначе Ctrl+Shift+D не смог бы набрать заглавную букву в поле.
 */
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    // Escape работает всегда: закрывает и окно, и выпадающее меню
    if (e.key === 'Escape') {
      setFileMenuOpen(false);
      if (modal) setModal(null);
      return;
    }

    if (!e.ctrlKey && !e.metaKey) return;
    if (e.altKey) return;

    const key = e.key.toLowerCase();

    if (key === 'f') {
      // Поиск всегда доступен: он не зависит от открытого окна
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }

    // Букваные сочетания не должны мешать набору текста
    if (e.shiftKey) return;
    if (modal) return;

    if (key === 'n') {
      e.preventDefault();
      setModal({ type: 'expense' });
    } else if (key === 'd') {
      e.preventDefault();
      setModal({ type: 'deposit' });
    }
  };

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}, [modal]);

// Меню «Файл» закрывается по клику вне и по Escape. Проверка попадания
  // внутрь нужна и для самой кнопки: иначе mousedown по ней закрыл бы меню,
  // и следующий click тут же открыл бы его снова.
  useEffect(() => {
    if (!fileMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFileMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fileMenuOpen]);

  // Состояние обновления приходит из главного процесса: загрузка идёт там,
  // а окно могло перерисоваться или сменить период.
  useEffect(() => {
    if (!window.electronAPI.onUpdateStatus) return;
    const off = window.electronAPI.onUpdateStatus(setUpdateStatus);
    window.electronAPI.getUpdateStatus?.().then(setUpdateStatus).catch(() => {});
    return off;
  }, []);

  // Итоги считаем по отфильтрованным данным: тогда сумма в шапке всегда
  // соответствует тому, что реально видно в таблице. С фильтром она
  // относится к найденному, без фильтра — ко всему периоду.
  const totalExpenses = useMemo(
    () => visibleExpenses.reduce((sum, e) => sum + e.amount, 0),
    [visibleExpenses]
  );

  const totalDeposits = useMemo(
    () => visibleDeposits.reduce((sum, d) => sum + d.amount, 0),
    [visibleDeposits]
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

  /**
   * Отмена удаления операции.
   *
   * Запись достаётся из уже загруженного списка ДО удаления: после
   * deleteExpense повторный запрос вернул бы пустоту. Если запись вдруг не
   * нашлась, восстанавливать нечего — молча выходим, чтобы не показать
   * несуществующую кнопку «Отменить».
   */
  const undoDelete = useCallback(
    async (
      restore: () => Promise<unknown>,
      reload: () => Promise<unknown>
    ) => {
      try {
        await restore();
        await reload();
        addToast('Восстановлено', 'success');
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : 'Не удалось восстановить запись',
          'error'
        );
      }
    },
    [addToast]
  );

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
      // Список нужен, чтобы найти саму трату: после удаления её в нём не будет
      const removed = expenses.find((e) => e.id === id);
      await window.electronAPI.deleteExpense(id);
      await Promise.all([loadExpenses(period), loadBalances()]);
      if (!removed) {
        addToast('Трата удалена', 'info');
        return;
      }
      addToast('Трата удалена', 'info', {
        actionLabel: 'Отменить',
        onAction: () =>
          undoDelete(
            () => window.electronAPI.restoreExpense(removed),
            () => Promise.all([loadExpenses(period), loadBalances()]).then(() => undefined)
          ),
      });
    } else if (kind === 'deposit') {
      const removed = deposits.find((d) => d.id === id);
      await window.electronAPI.deleteDeposit(id);
      await Promise.all([loadExpenses(period), loadBalances()]);
      if (!removed) {
        addToast('Внесение удалено', 'info');
        return;
      }
      addToast('Внесение удалено', 'info', {
        actionLabel: 'Отменить',
        onAction: () =>
          undoDelete(
            () => window.electronAPI.restoreDeposit(removed),
            () => Promise.all([loadExpenses(period), loadBalances()]).then(() => undefined)
          ),
      });
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
    } else if (kind === 'recurring') {
      // Траты, созданные этим платежом, остаются: удаляется только
      // напоминание, а не сама история расходов
      await window.electronAPI.deleteRecurring(id);
      addToast('Платёж удалён', 'info');
      await loadRecurring();
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
  /**
 * Отметка «оплачено» по регулярному платежу.
 *
 * Сервер одной транзакцией создаёт трату и двигает платёж на следующий
 * период, поэтому сюда остаётся только перезагрузить данные и показать,
 * на какую дату платёж переехал.
 */
const handlePayRecurring = async (id: number) => {
    try {
      const result = await window.electronAPI.payRecurring(id);
      if (!result.success) {
        addToast(result.message || 'Не удалось отметить платёж', 'error');
        return;
      }
      await Promise.all([loadRecurring(), loadExpenses(period), loadBalances()]);
      const when = result.nextDate
        ? new Date(result.nextDate).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
          })
        : '';
      addToast(`Трата создана, следующий платёж ${when}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Не удалось отметить платёж', 'error');
    }
  };

  const handleAddRecurring = async (
    payload: Parameters<typeof window.electronAPI.addRecurring>[0]
  ) => {
    const res = await window.electronAPI.addRecurring(payload);
    if (res.success) {
      await loadRecurring();
      addToast('Платёж добавлен', 'success');
    }
    return res;
  };

  const handleUpdateRecurring = async (
    id: number,
    patch: Parameters<typeof window.electronAPI.updateRecurring>[1]
  ) => {
    const res = await window.electronAPI.updateRecurring(id, patch);
    if (res.success) {
      await loadRecurring();
      // Простое переключение показываем отдельно, а правку формы — нет:
      // там пользователь и так видит, что сохранил
      if (Object.keys(patch).length === 1 && 'isActive' in patch) {
        addToast(patch.isActive ? 'Платёж включён' : 'Платёж выключен', 'info');
      }
    }
    return res;
  };

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

  // ——— Обновление программы ———
const handleCheckUpdate = async () => {
  try {
    const status = await window.electronAPI.checkUpdate();
    setUpdateStatus(status);
    // Найдена новая версия — сразу качаем, как и ожидается от кнопки
    if (status.state === 'available') {
      await window.electronAPI.downloadUpdate();
    }
  } catch (err) {
    addToast(
      err instanceof Error ? err.message : 'Не удалось проверить обновление',
      'error'
    );
  }
};

const handleInstallUpdate = async () => {
  try {
    const result = await window.electronAPI.installUpdate();
    if (!result.success && result.message) {
      addToast(result.message, 'error');
    }
    // При успехе программа закрывается — закрывать окно вручную не нужно
  } catch (err) {
    addToast(
      err instanceof Error ? err.message : 'Не удалось установить обновление',
      'error'
    );
  }
};

const handleOpenReleases = async () => {
  await window.electronAPI.openReleasePage();
};

// ——— Рендер ———
  return (
    <div className="app" data-platform={window.electronAPI.platform}>
      {/* Панель заголовка: меню «Файл» + перетаскивание окна */}
      <div className="drag-region">
        <div className="file-menu" ref={fileMenuRef}>
          <button
            className={`file-menu-trigger ${fileMenuOpen ? 'open' : ''}`}
            onClick={() => setFileMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
          >
            Файл
          </button>

          {fileMenuOpen && (
            <div className="file-menu-dropdown" role="menu">
              <button
                className="file-menu-item"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setModal({ type: 'balance' });
                }}
              >
                <Wallet size={15} />
                Указать остаток
              </button>
              <button
                className="file-menu-item"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  handleMakeBackup();
                }}
              >
                <Save size={15} />
                Резервная копия
              </button>
              <div className="file-menu-separator" />
              <button
                className="file-menu-item"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setModal({ type: 'update' });
                }}
              >
                <RefreshCw size={15} />
                Проверить обновление
              </button>
              <button
                className="file-menu-item"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setModal({ type: 'recurring' });
                }}
              >
                <Repeat size={15} />
                Регулярные платежи
              </button>
              <div className="file-menu-separator" />
              <div className="file-menu-shortcuts">
                <div className="file-menu-shortcuts-title">Горячие клавиши</div>
                <div className="file-menu-shortcut">
                  <span>Новая трата</span>
                  <kbd>Ctrl+N</kbd>
                </div>
                <div className="file-menu-shortcut">
                  <span>Новое внесение</span>
                  <kbd>Ctrl+D</kbd>
                </div>
                <div className="file-menu-shortcut">
                  <span>Поиск</span>
                  <kbd>Ctrl+F</kbd>
                </div>
                <div className="file-menu-shortcut">
                  <span>Закрыть окно</span>
                  <kbd>Esc</kbd>
                </div>
              </div>
              <div className="file-menu-footer">
                Траты Сани v{__APP_VERSION__}
              </div>
            </div>
          )}
        </div>

        <span className="drag-region-title">
          Траты Сани <span className="drag-region-version">v{__APP_VERSION__}</span>
        </span>

        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
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
          onDeleteCategory={(id) => askDelete('category', id)}
          onDeleteSubcategory={(id) => askDelete('subcategory', id)}
          recurring={dueRecurring}
          recurringMonthly={recurringMonthly}
          onPayRecurring={handlePayRecurring}
          onOpenRecurringManager={() => setModal({ type: 'recurring' })}
        />

        <ExpenseTable
          activeTab={activeTab}
          expenses={visibleExpenses}
          deposits={visibleDeposits}
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
          onRepeatExpense={(expense) => setModal({ type: 'repeatExpense', expense })}
          onRepeatDeposit={(deposit) => setModal({ type: 'repeatDeposit', deposit })}
          filter={tableFilter}
          onFilterChange={setTableFilter}
          searchRef={searchRef}
          hiddenCount={hiddenCount}
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

      {/* Повтор траты: форма открывается заполненной, но с сегодняшней датой */}
      {modal?.type === 'repeatExpense' && (
        <AddExpenseModal
          categories={categories}
          preselectedCategoryId={modal.expense.category_id}
          prefill={{
            amount: modal.expense.amount,
            note: modal.expense.note,
            subcategoryId: modal.expense.subcategory_id,
            subitemId: modal.expense.subitem_id,
          }}
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

      {/* Повтор внесения: сумма и категория из строки, дата сегодняшняя */}
      {modal?.type === 'repeatDeposit' && (
        <AddDepositModal
          depositCategories={depositCategories}
          prefill={{ amount: modal.deposit.amount, categoryId: modal.deposit.category_id }}
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

      {modal?.type === 'recurring' && (
        <RecurringModal
          categories={categories}
          items={recurring}
          monthlyTotal={recurringMonthly}
          onClose={() => setModal(null)}
          onAdd={handleAddRecurring}
          onUpdate={handleUpdateRecurring}
          onDelete={(id) => {
            const item = recurring.find((r) => r.id === id);
            setModal(null);
            setConfirmDelete({
              kind: 'recurring',
              id,
              title: item?.title,
            });
          }}
          onPay={handlePayRecurring}
        />
      )}

      {modal?.type === 'update' && (
        <UpdateModal
          status={updateStatus}
          currentVersion={__APP_VERSION__}
          onCheck={handleCheckUpdate}
          onInstall={handleInstallUpdate}
          onOpenReleases={handleOpenReleases}
          onClose={() => setModal(null)}
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
              : confirmDelete.kind === 'recurring'
              ? `Удалить регулярный платёж «${confirmDelete.title ?? ''}»? ` +
                'Траты, которые он уже создал, останутся в истории.'
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