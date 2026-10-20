import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, Save, RefreshCw, Sun, Moon, Repeat, HandCoins, ArrowLeftRight } from 'lucide-react';
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
import { LoansIncomeModal } from './components/Loans';
import { TransferModal } from './components/Transfers';
import { MovementsModal } from './components/Movements';
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
  RecurringFrequency,
  LoanItem,
  RecurringIncomeItem,
  AccountBalance,
  TransferItem,
  MoneyMovement,
} from './types';
import type { MainTab } from './components/ExpenseTable';
import {
  formatMoney,
  getPeriodLabel,
  getPresetPeriod,
  parseCategoriesSubcategories,
} from './lib/format';

/**
 * Подтверждение удаления справочника.
 *
 * С 1.0.22 удаление не трогает траты: из справочника исчезает только сам
 * список, а уже проведённые операции остаются в базе под ключом
 * «Без категории». Поэтому здесь важно не написать «будут удалены N трат» —
 * это было бы неправдой, и человек удалил бы категорию, побоявшись за историю.
 */
function buildDeleteMessage(
  kind: 'category' | 'subcategory' | 'subitem',
  impact?: { expenses: number; subcategories: number; subitems?: number; recurring?: number }
): string {
  const noun =
    kind === 'category'
      ? 'эту категорию'
      : kind === 'subcategory'
      ? 'эту подкатегорию'
      : 'эту статью';
  const dictParts: string[] = [];
  if (impact && impact.subcategories > 0) {
    dictParts.push(`${impact.subcategories} подкатегорий`);
  }
  if (impact && impact.subitems && impact.subitems > 0) {
    dictParts.push(`${impact.subitems} статей`);
  }
  if (impact && impact.recurring && impact.recurring > 0) {
    dictParts.push(`${impact.recurring} регулярных платежей`);
  }

  const dict = dictParts.length > 0 ? ` ${dictParts.join(' и ')}` : '';
  const trades =
    impact && impact.expenses > 0
      ? ` Траты останутся в базе (${impact.expenses} шт.) и покажутся как «Без категории».`
      : '';

  return `Удалить ${noun}? Из справочника исчезнет${dict}.${trades} Отменить это действие нельзя.`;
}

/**
 * Удаление категории внесений уносит с собой и сами внесения. Формулировка
 * отдельно напоминает про остаток: внесения его увеличивают, поэтому после
 * удаления денег станет меньше — и без этого предупреждения перемена выглядит
 * как ошибка программы.
 */
function buildDepositCategoryDeleteMessage(name: string, count: number): string {
  const quoted = name ? `«${name}»` : 'эту категорию';
  if (count === 0) {
    return `Удалить категорию внесений ${quoted}?`;
  }
  const plural =
    count % 10 === 1 && count % 100 !== 11
      ? 'внесение'
      : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)
      ? 'внесения'
      : 'внесений';
  return (
    `Удалить категорию внесений ${quoted}? Вместе с ней будут удалены ` +
    `${count} ${plural} — остаток уменьшится на их сумму. Отменить это действие нельзя.`
  );
}

/**
 * Удаление займа уносит и его записи — приход и возвраты. Про остаток говорим
 * прямо: удаление входящего внесения уменьшает деньги, и без предупреждения
 * перемена выглядит как ошибка.
 */
function buildLoanDeleteMessage(title: string): string {
  const quoted = title ? `«${title}»` : 'этот заём';
  return (
    `Удалить заём ${quoted}? Вместе с ним удалятся его внесение и возвраты — ` +
    'остаток изменится, а в отчёте пропадёт строка займа. Отменить нельзя.'
  );
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

  // ——— Займы и регулярные внесения ———
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [recurringIncome, setRecurringIncome] = useState<RecurringIncomeItem[]>([]);
  const [incomeMonthly, setIncomeMonthly] = useState(0);

  // ——— Счета и перемещения ———
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [movementsData, setMovementsData] = useState<{
    movements: MoneyMovement[];
    withheld: number;
    loanDebt: number;
    loanTaken: number;
    loanRepaid: number;
  } | null>(null);

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
    | { type: 'loans' }
    | { type: 'transfers' }
    | { type: 'movements' }
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
          | 'recurring'
          | 'depositCategory'
          | 'loan'
          | 'income';
        id: number;
        impact?: {
    expenses: number;
    subcategories: number;
    subitems?: number;
    recurring?: number;
  };
        /** Сколько внесений исчезнет вместе с категорией внесений */
        depositsCount?: number;
        /** Название категории внесений — для понятного вопроса */
        depositCategoryName?: string;
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

  /** Загрузка займов и регулярных внесений — обе суммы считаются на сервере */
  const loadLoansAndIncome = useCallback(async () => {
    const [loansData, incomeData, monthly] = await Promise.all([
      window.electronAPI.getLoans(),
      window.electronAPI.getRecurringIncome(),
      window.electronAPI.getRecurringIncomeMonthlyTotal(),
    ]);
    setLoans(loansData);
    setRecurringIncome(incomeData);
    setIncomeMonthly(monthly);
  }, []);

  /**
   * Загрузка счетов и переводов.
   *
   * Счета тянутся всегда, переводы — только за текущий период: список нужен
   * ради остатков по счетам, а переводы показываются в окне, которое открывают
   * изредка.
   */
  const loadAccounts = useCallback(async () => {
    const data = await window.electronAPI.getAccountBalances();
    setAccounts(data);
  }, []);

  const loadTransfers = useCallback(async () => {
    const data = await window.electronAPI.getTransfers({
      startDate: period.startDate,
      endDate: period.endDate,
    });
    setTransfers(data);
  }, [period]);

  const loadMovements = useCallback(async () => {
    const data = await window.electronAPI.getMoneyMovements({
      startDate: period.startDate,
      endDate: period.endDate,
    });
    setMovementsData(data);
  }, [period]);

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

  const loadExpenses = useCallback(
    async (p: Period) => {
      // Фильтр по счёту уходит в базу, а не в память: это жёсткая граница
      // «покажи только эти деньги», а не поиск по тексту. Поиск остаётся
      // в памяти — период и так загружен целиком.
      const [expenseData, depositData] = await Promise.all([
        window.electronAPI.getExpenses(p.startDate, p.endDate, selectedAccountId),
        window.electronAPI.getDeposits(p.startDate, p.endDate, selectedAccountId),
      ]);
      setExpenses(expenseData);
      setDeposits(depositData);
      setLoading(false);
    },
    [selectedAccountId]
  );

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

  /**
   * Пересчёт всех денежных сумм на экране.
   *
   * Остаток и суммы по счетам берутся из разных источников: первый — общий
   * итог, второй — разбивка по счетам для боковой панели. Но меняет их одно и
   * то же действие, поэтому обновляются они всегда вместе. Раньше удаление
   * внесения пересчитывало остаток и забывало про счета, и боковая панель
   * показывала сумму удалённой записи ещё несколько секунд.
   */
  const loadBalances = useCallback(async () => {
    const [balance] = await Promise.all([
      window.electronAPI.getCurrentBalance(),
      loadAccounts(),
    ]);
    setCurrentBalance(balance.balance);
    setBaseCheckpoint({ amount: balance.base, date: balance.baseDate });
  }, [loadAccounts]);

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
          loadLoansAndIncome(),
          loadAccounts(),
        ]);
      } catch (err) {
        console.error('Ошибка загрузки:', err);
        addToast('Ошибка при загрузке данных', 'error');
        setLoading(false);
      }
    })();
  }, [
    loadCategories,
    loadExpenses,
    loadBalances,
    loadRecurring,
    loadLoansAndIncome,
    loadAccounts,
  ]);

  useEffect(() => {
    loadExpenses(period).catch(() => {});
  }, [period, loadExpenses]);

  // Переводы нужны только внутри окна переводов. Грузим при открытии, а не
  // всегда: список привязан к периоду, и держать его в памяти постоянно
  // незачем.
  useEffect(() => {
    if (modal?.type !== 'transfers') return;
    loadTransfers().catch(() => {});
  }, [modal?.type, loadTransfers]);

  // Движение денег живёт в своём окне и тоже подвязано к периоду
  useEffect(() => {
    if (modal?.type !== 'movements') return;
    loadMovements().catch(() => {});
  }, [modal?.type, loadMovements]);

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
    const saved = await window.electronAPI.addExpense(data);
    setModal(null);
    // Предупреждение заменяет обычное подтверждение: запись создана, но в
    // остаток не попала. Два тоста подряд читались бы как «сохранилось» и
    // «ошибка» одновременно.
    addToast(
      saved?.warning
        ? `Трата ${formatMoney(data.amount)} добавлена, но в остаток не вошла. ${saved.warning}`
        : `Трата ${formatMoney(data.amount)} добавлена`,
      saved?.warning ? 'error' : 'success',
      saved?.warning ? { duration: 12000 } : undefined
    );
    await Promise.all([loadExpenses(period), loadBalances()]);
  };

  const handleAddBalance = async (data: { amount: number; date: string; note?: string }) => {
    await window.electronAPI.addBalance(data);
    setModal(null);
    addToast(`Остаток ${formatMoney(data.amount)} сохранён на ${data.date}`);
    await loadBalances();
  };

  const handleAddDeposit = async (data: { amount: number; date: string; categoryId: number }) => {
    try {
      const saved = await window.electronAPI.addDeposit(data);
      setModal(null);
      const label = saved?.category_name ? ` — ${saved.category_name}` : '';
      addToast(
        saved?.warning
          ? `Внесено ${formatMoney(data.amount)}${label}, но в остаток не вошло. ${saved.warning}`
          : `Внесено ${formatMoney(data.amount)}${label}`,
        saved?.warning ? 'error' : 'success',
        saved?.warning ? { duration: 12000 } : undefined
      );
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

  /**
   * Удаление категории внесений убирает вместе с ней и сами внесения — так же,
   * как категория трат убирает траты. Поэтому спрашиваем подтверждение и прямо
   * говорим, сколько записей пропадёт: остаток уменьшится на их сумму.
   */
  const handleAskDeleteDepositCategory = (id: number) => {
    const cat = depositCategories.find((c) => c.id === id);
    setConfirmDelete({
      kind: 'depositCategory',
      id,
      depositsCount: cat?.deposits_count ?? 0,
      depositCategoryName: cat?.name ?? '',
    });
  };

  /** Смена названия на любом из четырёх уровней */
  const makeRenameHandler =
    (call: (id: number, name: string) => Promise<{ success: boolean; name: string }>) =>
    async (id: number, name: string) => {
      await call(id, name);
      await Promise.all([loadCategories(), loadDepositCategories(), loadExpenses(period)]);
    };

  const handleRenameCategory = makeRenameHandler((id, name) =>
    window.electronAPI.renameCategory(id, name)
  );
  const handleRenameSubcategory = makeRenameHandler((id, name) =>
    window.electronAPI.renameSubcategory(id, name)
  );
  const handleRenameSubitem = makeRenameHandler((id, name) =>
    window.electronAPI.renameSubitem(id, name)
  );
  const handleRenameDepositCategory = makeRenameHandler((id, name) =>
    window.electronAPI.renameDepositCategory(id, name)
  );

  /** Объединение категорий: основная остаётся, остальные переезжают в неё */
  const handleMergeCategories = async (targetId: number, sourceIds: number[]) => {
    const res = await window.electronAPI.mergeCategories({ targetId, sourceIds });
    await Promise.all([loadCategories(), loadExpenses(period), loadRecurring()]);
    const parts: string[] = [];
    if (res.movedSubcategories > 0) parts.push(`${res.movedSubcategories} подк.`);
    if (res.mergedSubcategories > 0) parts.push(`${res.mergedSubcategories} слито`);
    if (res.movedExpenses > 0) parts.push(`${res.movedExpenses} трат`);
    if (res.movedRecurring > 0) parts.push(`${res.movedRecurring} платежей`);
    addToast(
      parts.length > 0
        ? `Объединено в «${res.targetName}»: ${parts.join(', ')}`
        : `Объединено в «${res.targetName}»`,
      'success'
    );
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
      await Promise.all([loadExpenses(period), loadBalances(), loadMovements()]);
      if (!removed) {
        addToast('Трата удалена', 'info');
        return;
      }
      addToast('Трата удалена', 'info', {
        actionLabel: 'Отменить',
        onAction: () =>
          undoDelete(
            () => window.electronAPI.restoreExpense(removed),
            () =>
              Promise.all([loadExpenses(period), loadBalances(), loadMovements()]).then(
                () => undefined
              )
          ),
      });
    } else if (kind === 'deposit') {
      const removed = deposits.find((d) => d.id === id);
      await window.electronAPI.deleteDeposit(id);
      await Promise.all([loadExpenses(period), loadBalances(), loadMovements()]);
      if (!removed) {
        addToast('Внесение удалено', 'info');
        return;
      }
      addToast('Внесение удалено', 'info', {
        actionLabel: 'Отменить',
        onAction: () =>
          undoDelete(
            () => window.electronAPI.restoreDeposit(removed),
            () =>
              Promise.all([loadExpenses(period), loadBalances(), loadMovements()]).then(
                () => undefined
              )
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
    } else if (kind === 'depositCategory') {
      const removedCount = confirmDelete?.depositsCount ?? 0;
      await window.electronAPI.deleteDepositCategory(id);
      addToast(
        removedCount > 0
          ? `Категория удалена вместе с ${removedCount} внес.`
          : 'Категория удалена',
        'info'
      );
      await Promise.all([loadDepositCategories(), loadExpenses(period), loadBalances()]);
    } else if (kind === 'loan') {
      const res = await window.electronAPI.deleteLoan(id);
      // Движение денег обязательно среди перезагрузок: удаление займа уносит
      // и внесение, и возврат, и без этого их строки остались бы висеть на
      // экране движения до переоткрытия окна.
      await Promise.all([
        loadLoansAndIncome(),
        loadExpenses(period),
        loadBalances(),
        loadAccounts(),
        loadMovements(),
      ]);
      const parts: string[] = [];
      if (res.deletedDeposits > 0) {
        parts.push(`${res.deletedDeposits} внес.`);
      }
      if (res.deletedExpenses > 0) {
        parts.push(`${res.deletedExpenses} возврат.`);
      }
      addToast(
        parts.length > 0
          ? `Заём удалён вместе с записями: ${parts.join(', ')}`
          : 'Заём удалён',
        'info'
      );
    } else if (kind === 'income') {
      await window.electronAPI.deleteRecurringIncome(id);
      await loadLoansAndIncome();
      addToast('Выплата удалена', 'info');
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
      const result = await window.electronAPI.payRecurring(id, selectedAccountId ?? undefined);
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

  /**
 * Оплата платежа, выбранного в календаре.
 *
 * Календарь отдаёт название и сумму, а не id: он строит сетку по датам и
 * не знает про строки списка. Поэтому платёж ищется по названию среди
 * действующих. Название здесь служит ключом — при совпадении двух
 * платежей оплатится первый, что для регулярных услуг безобидно.
 */
const handlePayRecurringByTitle = async (title: string, amount: number) => {
    const match = recurring.find((r) => r.title === title && Math.abs(r.amount - amount) < 0.01);
    if (!match) {
      addToast('Платёж не найден среди регулярных — обновите окно', 'error');
      return;
    }
    await handlePayRecurring(match.id);
  };

  // ——— Займы и регулярные внесения ———

  const handleAddLoan = async (payload: {
    title: string;
    source?: string;
    amount: number;
    dateTaken: string;
    dateDue: string;
    depositCategoryId?: number;
    note?: string;
  }) => {
    const res = await window.electronAPI.addLoan({
      ...payload,
      accountId: selectedAccountId ?? undefined,
    });
    await Promise.all([
      loadLoansAndIncome(),
      loadExpenses(period),
      loadBalances(),
      loadAccounts(),
      loadMovements(),
    ]);
    addToast(
      res.recordedDeposit
        ? `Заём заведён, деньги записаны как поступление`
        : 'Заём заведён',
      'success'
    );
  };

  const handleRepayLoan = async (payload: {
    id: number;
    amount: number;
    categoryId: number;
    date: string;
    accountId?: number;
  }) => {
    const res = await window.electronAPI.repayLoan({
      ...payload,
      accountId: payload.accountId ?? selectedAccountId ?? undefined,
    });
    await Promise.all([
      loadLoansAndIncome(),
      loadExpenses(period),
      loadBalances(),
      loadAccounts(),
      loadMovements(),
    ]);
    addToast(
      res.remaining > 0.001
        ? `Возврат записан, осталось ${formatMoney(res.remaining)}`
        : 'Заём погашен',
      'success'
    );
  };

  const handleDeleteLoan = (id: number) => {
    const loan = loans.find((l) => l.id === id);
    setConfirmDelete({
      kind: 'loan',
      id,
      title: loan?.title ?? '',
      depositsCount: loans.filter((l) => l.remaining > 0.001).length,
    });
  };

  const handleAddIncome = async (payload: {
    title: string;
    categoryId: number;
    amount: number;
    commissionPercent: number;
    frequency: RecurringFrequency;
    nextDate: string;
    accountId?: number;
  }) => {
    const res = await window.electronAPI.addRecurringIncome(payload);
    await loadLoansAndIncome();
    addToast(`Выплата добавлена: на руки ${formatMoney(res.net)}`, 'success');
  };

  const handleUpdateIncome = async (
    id: number,
    payload: {
      title: string;
      categoryId: number;
      amount: number;
      commissionPercent: number;
      frequency: RecurringFrequency;
      nextDate: string;
      accountId?: number;
    }
  ) => {
    const res = await window.electronAPI.updateRecurringIncome({ id, ...payload });
    await loadLoansAndIncome();
    addToast(`Сохранено: на руки ${formatMoney(res.net)}`, 'success');
  };

  /** Отметка выплаты: сервер создаёт внесение на дату выплаты и двигает дату */
  const handleReceiveIncome = async (id: number, actualAmount?: number) => {
    try {
      const res = await window.electronAPI.receiveRecurringIncome(id, {
        actualAmount,
        accountId: selectedAccountId ?? undefined,
      });
      await Promise.all([
        loadLoansAndIncome(),
        loadExpenses(period),
        loadBalances(),
        loadAccounts(),
        loadMovements(),
      ]);
      const when = new Date(res.date).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
      });
      const next = new Date(res.nextDate).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
      });
      addToast(
        `Внесено ${formatMoney(res.net)} от ${when}, следующая ${next}` +
          (res.withheld > 0 ? `. Агрегатор удержал ${formatMoney(res.withheld)}` : ''),
        'success'
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Не удалось отметить выплату', 'error');
    }
  };

  const handleToggleIncome = async (id: number) => {
    await window.electronAPI.toggleRecurringIncome(id);
    await loadLoansAndIncome();
  };

  const handleDeleteIncome = (id: number) => {
    const item = recurringIncome.find((i) => i.id === id);
    setConfirmDelete({
      kind: 'income',
      id,
      title: item?.title ?? '',
    });
  };

  // ——— Счета и перемещения ———

  const handleAddAccount = async (name: string) => {
    await window.electronAPI.addAccount({ name });
    await Promise.all([loadAccounts(), loadBalances()]);
    addToast(`Счёт «${name}» добавлен`, 'success');
  };

  const handleRenameAccount = async (id: number, name: string) => {
    try {
      await window.electronAPI.renameAccount(id, name);
      await loadAccounts();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Не удалось переименовать счёт', 'error');
      throw err;
    }
  };

  const handleDeleteAccount = async (id: number) => {
    const acc = accounts.find((a) => a.id === id);
    try {
      await window.electronAPI.deleteAccount(id);
      // Выбранный счёт мог исчезнуть — тогда возвращаемся к «всем счетам».
      if (selectedAccountId === id) setSelectedAccountId(null);
      await Promise.all([loadAccounts(), loadBalances(), loadTransfers()]);
      addToast(
        acc ? `Счёт «${acc.name}» удалён, операции перешли на основной` : 'Счёт удалён',
        'info'
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Не удалось удалить счёт', 'error');
    }
  };

  const handleAddTransfer = async (payload: {
    fromAccountId: number;
    toAccountId: number;
    amount: number;
    date: string;
    note?: string;
  }) => {
    await window.electronAPI.addTransfer(payload);
    await Promise.all([loadAccounts(), loadTransfers(), loadBalances()]);
    addToast(`Перевод ${formatMoney(payload.amount)} записан`, 'success');
  };

  const handleDeleteTransfer = async (id: number) => {
    await window.electronAPI.deleteTransfer(id);
    // Перевод удаляется прямо из окна движения, поэтому перечитывать его
    // обязательно — иначе строка осталась бы висеть под курсором.
    await Promise.all([loadAccounts(), loadTransfers(), loadBalances(), loadMovements()]);
    addToast('Перевод удалён', 'info');
  };

  /**
 * Загрузка месяца для календаря.
 *
 * Обязательно useCallback: функция передаётся в эффект окна как зависимость,
 * и новая ссылка на каждый рендер запускала бы загрузку снова — бесконечный
 * цикл «запросил → отрисовал → запросил».
 */
const loadRecurringCalendar = useCallback(
    (startDate: string, endDate: string) =>
      window.electronAPI.getRecurringCalendar({ startDate, endDate }),
    []
  );

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
    // Кредиты — слагаемое, без которого суммы выше не дают «На выходе».
    // Не пишем его безусловно: в периоде без займов строка только мешает.
    if (rep.loanTaken > 0 || rep.loanRepaid > 0) {
      lines.push(
        `Кредиты за период: взято ${rep.loanTaken.toFixed(2)} ₸, ` +
          `возвращено ${rep.loanRepaid.toFixed(2)} ₸, итого ${rep.loanNet.toFixed(2)} ₸`
      );
    }
    // Удержание агрегатора — не трата, в суммы не входит, но сумму отнимает
    // от того, что было начислено. Отдельной строкой, иначе в выгрузке пропадёт.
    if (rep.withheldByAggregators > 0) {
      lines.push(`Удержано агрегаторами: ${rep.withheldByAggregators.toFixed(2)} ₸ (из внесений)`);
    }
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
      const cat = (exp.category_name || 'Без категории').replace(/;/g, ',');
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
        // Кредиты и удержание агрегаторов — в том же отчёте, что и на экране.
        // Без них файл показывает суммы, которые не дают «На выходе».
        loanTaken: rep.loanTaken,
        loanRepaid: rep.loanRepaid,
        withheldByAggregators: rep.withheldByAggregators,
        checkpoint: rep.baseCheckpoint,
        expenseRows: rep.expenses.map((e) => ({
          date: e.date,
          category: e.category_name || 'Без категории',
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
              <button
                className="file-menu-item"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setModal({ type: 'loans' });
                }}
              >
                <HandCoins size={15} />
                Займы и выплаты
              </button>
              <button
                className="file-menu-item"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setModal({ type: 'transfers' });
                }}
              >
                <ArrowLeftRight size={15} />
                Переводы между счетами
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

        {/* Движение денег — в строке меню, сразу за «Файл», а не на главной
            панели среди «Трата»/«Внесение». Там уже четыре кнопки, и пятая
            сдвигала бы то, чем пользуются каждый день. */}
        <button
          className="file-menu-trigger"
          onClick={() => setModal({ type: 'movements' })}
        >
          <ArrowLeftRight size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
          Движение денег
        </button>

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
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          onAddAccount={handleAddAccount}
          onRenameAccount={handleRenameAccount}
          onDeleteAccount={handleDeleteAccount}
          onOpenTransfer={() => setModal({ type: 'transfers' })}
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
          accounts={accounts}
          preselectedAccountId={selectedAccountId}
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
          accounts={accounts}
          preselectedAccountId={selectedAccountId}
          preselectedCategoryId={modal.expense.category_id}
          prefill={{
            amount: modal.expense.amount,
            note: modal.expense.note,
            subcategoryId: modal.expense.subcategory_id,
            subitemId: modal.expense.subitem_id,
            accountId: modal.expense.account_id,
          }}
          onClose={() => setModal(null)}
          onSubmit={handleAddExpense}
        />
      )}

      {modal?.type === 'deposit' && (
        <AddDepositModal
          depositCategories={depositCategories}
          accounts={accounts}
          preselectedAccountId={selectedAccountId}
          onClose={() => setModal(null)}
          onSubmit={handleAddDeposit}
          onAddCategory={handleAddDepositCategory}
        />
      )}

      {/* Повтор внесения: сумма и категория из строки, дата сегодняшняя */}
      {modal?.type === 'repeatDeposit' && (
        <AddDepositModal
          depositCategories={depositCategories}
          accounts={accounts}
          preselectedAccountId={selectedAccountId}
          prefill={{
            amount: modal.deposit.amount,
            categoryId: modal.deposit.category_id,
            accountId: modal.deposit.account_id,
          }}
          onClose={() => setModal(null)}
          onSubmit={handleAddDeposit}
          onAddCategory={handleAddDepositCategory}
        />
      )}

      {modal?.type === 'balance' && (
        <AddBalanceModal
          accounts={accounts}
          preselectedAccountId={selectedAccountId}
          onClose={() => setModal(null)}
          onSubmit={handleAddBalance}
        />
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
          onDeleteDepositCategory={handleAskDeleteDepositCategory}
          onRenameCategory={handleRenameCategory}
          onRenameSubcategory={handleRenameSubcategory}
          onRenameSubitem={handleRenameSubitem}
          onRenameDepositCategory={handleRenameDepositCategory}
          onMergeCategories={handleMergeCategories}
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
          onPayByTitle={handlePayRecurringByTitle}
          loadCalendar={loadRecurringCalendar}
        />
      )}

      {modal?.type === 'loans' && (
        <LoansIncomeModal
          loans={loans}
          income={recurringIncome}
          depositCategories={depositCategories}
          expenseCategories={categories}
          accounts={accounts}
          loanDebtTotal={loans.reduce((sum, l) => sum + l.remaining, 0)}
          incomeMonthlyTotal={incomeMonthly}
          onClose={() => setModal(null)}
          onAddLoan={handleAddLoan}
          onRepayLoan={handleRepayLoan}
          onDeleteLoan={handleDeleteLoan}
          onAddIncome={handleAddIncome}
          onUpdateIncome={handleUpdateIncome}
          onReceiveIncome={handleReceiveIncome}
          onToggleIncome={handleToggleIncome}
          onDeleteIncome={handleDeleteIncome}
        />
      )}

      {modal?.type === 'movements' && (
        <MovementsModal
          data={movementsData}
          onClose={() => setModal(null)}
          onDeleteTransfer={handleDeleteTransfer}
        />
      )}

      {modal?.type === 'transfers' && (
        <TransferModal
          accounts={accounts}
          transfers={transfers}
          onClose={() => setModal(null)}
          onAdd={handleAddTransfer}
          onDelete={handleDeleteTransfer}
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
              : confirmDelete.kind === 'depositCategory'
              ? buildDepositCategoryDeleteMessage(
                  confirmDelete.depositCategoryName ?? '',
                  confirmDelete.depositsCount ?? 0
                )
              : confirmDelete.kind === 'loan'
              ? buildLoanDeleteMessage(confirmDelete.title ?? '')
              : confirmDelete.kind === 'income'
              ? `Удалить выплату «${confirmDelete.title ?? ''}»? Внесения, которые ` +
                'она уже создала, останутся в истории.'
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