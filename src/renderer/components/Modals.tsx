import { useEffect, useRef, useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Banknote,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Info,
  Pencil,
  Check,
  GitMerge,
} from 'lucide-react';
import type {
  Category,
  Subcategory,
  Subitem,
  DepositCategory,
  UpdateStatus,
  AccountBalance,
} from '../types';
import { toISODate, formatMoney } from '../lib/format';
import { CATEGORY_ICONS, getCategoryIcon, CHART_COLORS } from '../lib/icons';

interface AddExpenseModalProps {
  categories: Category[];
  preselectedCategoryId?: number | null;
  /** Подкатегория, выбранная в боковой панели — подставляется сразу */
  preselectedSubcategoryId?: number | null;
  /** Статья третьего уровня, выбранная в боковой панели */
  preselectedSubitemId?: number | null;
  /**
   * Данные для кнопки «Повторить»: форма открывается уже заполненной.
   * Дата при этом всегда сегодняшняя — повторяют расход, а не старый чек.
   */
  prefill?: {
    amount?: number | null;
    note?: string | null;
    subcategoryId?: number | null;
    subitemId?: number | null;
    accountId?: number | null;
  };
  /** Счета для выбора; первый (или отмеченный is_default) подставляется сам */
  accounts?: AccountBalance[];
  /** Счёт, выбранный в боковой панели — форма его подхватит */
  preselectedAccountId?: number | null;
  onClose: () => void;
  onSubmit: (data: {
    categoryId: number;
    subcategoryId?: number;
    subitemId?: number;
    amount: number;
    date: string;
    note?: string;
    accountId?: number;
  }) => void;
}

export default function AddExpenseModal({
  categories,
  preselectedCategoryId,
  preselectedSubcategoryId,
  preselectedSubitemId,
  prefill,
  accounts = [],
  preselectedAccountId,
  onClose,
  onSubmit,
}: AddExpenseModalProps) {
  const defaultAccountId =
    preselectedAccountId ??
    prefill?.accountId ??
    accounts.find((a) => a.is_default === 1)?.id ??
    accounts[0]?.id ??
    null;
  const [accountId, setAccountId] = useState<number | ''>(defaultAccountId ?? '');
  const [categoryId, setCategoryId] = useState<number>(
    preselectedCategoryId ?? categories[0]?.id ?? 0
  );
  const [subcategoryId, setSubcategoryId] = useState<number | ''>(
    preselectedSubcategoryId ?? prefill?.subcategoryId ?? ''
  );
  const [amount, setAmount] = useState(
    prefill?.amount != null ? String(prefill.amount) : ''
  );
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState(prefill?.note ?? '');
  const [subitemId, setSubitemId] = useState<number | ''>(
    preselectedSubitemId ?? prefill?.subitemId ?? ''
  );

  // Сбрасываем подкатегорию только при реальной смене категории.
  // На первом рендере эффект тоже сработал бы и стёр бы подставленное
  // из боковой панели значение.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSubcategoryId('');
    setSubitemId('');
  }, [categoryId]);

  // Смена подкатегории сбрасывает статью — она принадлежит другой ветке.
  // На первом рендере пропускаем: иначе стёрлась бы статья, подставленная
  // кнопкой «Повторить».
  const firstSubRender = useRef(true);
  useEffect(() => {
    if (firstSubRender.current) {
      firstSubRender.current = false;
      return;
    }
    setSubitemId('');
  }, [subcategoryId]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const subcategories: Subcategory[] = Array.isArray(selectedCategory?.subcategories)
    ? (selectedCategory?.subcategories as Subcategory[])
    : [];
  const selectedSub = subcategories.find((s) => s.id === subcategoryId);
  const subitems: Subitem[] = Array.isArray(selectedSub?.items)
    ? (selectedSub?.items as Subitem[])
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (!categoryId || isNaN(amountNum) || amountNum <= 0) return;
    onSubmit({
      categoryId,
      subcategoryId: subcategoryId ? Number(subcategoryId) : undefined,
      subitemId: subitemId ? Number(subitemId) : undefined,
      amount: amountNum,
      date,
      note: note.trim() || undefined,
      accountId: accountId === '' ? undefined : Number(accountId),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Добавить трату</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="expense-category">
              Категория
            </label>
            <div className="select-wrapper">
              <select
                id="expense-category"
                value={categoryId}
                onChange={(e) => setCategoryId(Number(e.target.value))}
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {subcategories.length > 0 && (
            <div className="form-group">
              <label className="form-label" htmlFor="expense-subcategory">
                Подкатегория
              </label>
              <div className="select-wrapper">
                <select
                  id="expense-subcategory"
                  value={subcategoryId}
                  onChange={(e) => setSubcategoryId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Без подкатегории</option>
                  {subcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {subitems.length > 0 && (
            <div className="form-group">
              <label className="form-label" htmlFor="expense-subitem">
                Статья
              </label>
              <div className="select-wrapper">
                <select
                  id="expense-subitem"
                  value={subitemId}
                  onChange={(e) => setSubitemId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Без статьи</option>
                  {subitems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="expense-amount">
                Сумма (₸)
              </label>
              <input
                id="expense-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="expense-date">
                Дата
              </label>
              <input
                id="expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Счёт вынесен в отдельную строку: в одной строке с суммой и датой
              он обрезался краем окна, а в названии счёта ещё остаток, который
              туда не помещался. */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="expense-account">
                Счёт
              </label>
              <select
                id="expense-account"
                value={accountId}
                onChange={(e) =>
                  setAccountId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatMoney(a.balance)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="expense-note">
              Комментарий (необязательно)
            </label>
            <input
              id="expense-note"
              type="text"
              placeholder="Дополнительная информация..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary">
              <Plus size={18} />
              Добавить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddDepositModalProps {
  depositCategories: DepositCategory[];
  onClose: () => void;
  onSubmit: (data: { amount: number; date: string; categoryId: number; accountId?: number }) => void;
  /** Создание новой категории прямо из формы */
  onAddCategory: (name: string) => Promise<{ id: number; name: string }>;
  /** Данные для кнопки «Повторить»; дата всегда сегодняшняя */
  prefill?: { amount?: number | null; categoryId?: number | null; accountId?: number | null };
  accounts?: AccountBalance[];
  preselectedAccountId?: number | null;
}

/**
 * Внесение денег. Категория обязательна — она заменила свободный комментарий,
 * чтобы одинаковые формулировки собирались в справочник и по ним можно было
 * строить разбивку отчёта. Проверка дублируется на сервере (см. db:addDeposit).
 */
export function AddDepositModal({
  depositCategories,
  onClose,
  onSubmit,
  onAddCategory,
  prefill,
  accounts = [],
  preselectedAccountId,
}: AddDepositModalProps) {
  const [accountId, setAccountId] = useState<number | ''>(
    preselectedAccountId ??
      prefill?.accountId ??
      accounts.find((a) => a.is_default === 1)?.id ??
      accounts[0]?.id ??
      ''
  );
  const [amount, setAmount] = useState(
    prefill?.amount != null ? String(prefill.amount) : ''
  );
  const [date, setDate] = useState(toISODate(new Date()));
  const [categoryId, setCategoryId] = useState<number | ''>(prefill?.categoryId ?? '');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const amountNum = parseFloat(amount.replace(',', '.'));
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const categoryValid = categoryId !== '' && categoryId != null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountValid || !categoryValid) return;
    onSubmit({
      amount: amountNum,
      date,
      categoryId: Number(categoryId),
      accountId: accountId === '' ? undefined : Number(accountId),
    });
  };

  const handleCreateCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const created = await onAddCategory(name);
      setCategoryId(created.id);
      setNewCategory('');
      setCategoryTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать категорию');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Внесение денег</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="deposit-amount">
                Сумма (₸) <span style={{ color: 'var(--accent-danger)' }}>*</span>
              </label>
              <input
                id="deposit-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="deposit-date">
                Дата <span style={{ color: 'var(--accent-danger)' }}>*</span>
              </label>
              <input
                id="deposit-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="deposit-account">
                Счёт
              </label>
              <select
                id="deposit-account"
                value={accountId}
                onChange={(e) =>
                  setAccountId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatMoney(a.balance)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="deposit-category">
              Категория внесения <span style={{ color: 'var(--accent-danger)' }}>*</span>
            </label>
            {depositCategories.length > 0 ? (
              <div className="select-wrapper">
                <select
                  id="deposit-category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value ? Number(e.target.value) : '');
                    if (categoryTouched) setError('');
                  }}
                  onBlur={() => setCategoryTouched(true)}
                  required
                >
                  <option value="">Выберите категорию…</option>
                  {depositCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field-hint" style={{ marginBottom: 8 }}>
                Категорий пока нет — создайте первую, например «Пополнение с карты».
              </div>
            )}
            {categoryTouched && !categoryValid && (
              <div className="field-error">Выберите категорию внесения</div>
            )}

            {/* Новая категория создаётся прямо здесь — не нужно закрывать форму */}
            <form
              className="inline-create"
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreateCategory();
              }}
            >
              <input
                type="text"
                placeholder="Новая категория внесения…"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                maxLength={120}
              />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={!newCategory.trim() || creating}
                title="Добавить категорию в справочник"
              >
                <Plus size={14} />
                {creating ? '...' : 'Добавить'}
              </button>
            </form>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!amountValid || !categoryValid}
              title={
                !amountValid
                  ? 'Укажите сумму больше нуля'
                  : !categoryValid
                  ? 'Выберите или создайте категорию внесения'
                  : undefined
              }
            >
              <Banknote size={18} />
              Внести
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddBalanceModalProps {
  onClose: () => void;
  onSubmit: (data: { amount: number; date: string; note?: string; accountId?: number }) => void;
  accounts?: AccountBalance[];
  preselectedAccountId?: number | null;
}

export function AddBalanceModal({ onClose, onSubmit, accounts = [], preselectedAccountId }: AddBalanceModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<number | ''>(
    preselectedAccountId ?? accounts.find((a) => a.is_default === 1)?.id ?? accounts[0]?.id ?? ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountNum)) return;
    onSubmit({
      amount: amountNum,
      date,
      note: note.trim() || undefined,
      accountId: accountId === '' ? undefined : Number(accountId),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Указать текущий остаток</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="balance-amount">
              Остаток (₸)
            </label>
            <input
              id="balance-amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="balance-date">
              Дата
            </label>
            <input
              id="balance-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
              <label className="form-label" htmlFor="balance-account">
                Счёт
              </label>
              <select
                id="balance-account"
                value={accountId}
                onChange={(e) =>
                  setAccountId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatMoney(a.balance)}
                  </option>
                ))}
              </select>
              <div className="field-hint" style={{ marginTop: 6 }}>
                Отметка относится к одному счёту. Чтобы задать остаток по всем —
                сделайте это на каждом отдельно.
              </div>
            </div>

          <div className="form-group">
            <label className="form-label" htmlFor="balance-note">
              Комментарий (необязательно)
            </label>
            <input
              id="balance-note"
              type="text"
              placeholder="Например: перевод на карту"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary">
              Сохранить остаток
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Окно проверки и установки обновления */
export function UpdateModal({
  status,
  currentVersion,
  onCheck,
  onInstall,
  onOpenReleases,
  onClose,
}: {
  status: UpdateStatus;
  currentVersion: string;
  onCheck: () => void;
  onInstall: () => void;
  onOpenReleases: () => void;
  onClose: () => void;
}) {
  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Обновление программы</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="update-body">
          <div className="update-current">
            Установленная версия: <strong>v{currentVersion}</strong>
          </div>

          {status.state === 'idle' && (
            <div className="field-hint">
              Нажмите «Проверить обновление», чтобы узнать, есть ли новая версия.
            </div>
          )}

          {status.state === 'checking' && (
            <div className="update-status">
              <RefreshCw size={16} className="spin" />
              <span>{status.message || 'Проверяю обновления…'}</span>
            </div>
          )}

          {status.state === 'not-available' && (
            <div className="update-status ok">
              <CheckCircle2 size={16} />
              <span>{status.message || 'Установлена последняя версия'}</span>
            </div>
          )}

          {status.state === 'available' && (
            <div className="update-status">
              <Download size={16} />
              <span>
                Доступна версия <strong>{status.version}</strong>
              </span>
            </div>
          )}

          {status.state === 'downloading' && (
            <div className="update-download">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${status.percent ?? 0}%` }} />
              </div>
              <div className="progress-label">Загружаю… {status.percent ?? 0}%</div>
            </div>
          )}

          {status.state === 'downloaded' && (
            <div className={`update-status ${status.canInstall ? 'ok' : 'notice'}`}>
              {status.canInstall ? (
                <CheckCircle2 size={16} />
              ) : (
                <Info size={16} />
              )}
              <span>
                {status.message ||
                  `Версия ${status.version} загружена и готова к установке`}
              </span>
            </div>
          )}

          {status.state === 'error' && (
            <div className="update-status error">
              <AlertCircle size={16} />
              <span>{status.message}</span>
            </div>
          )}

          {status.canInstall === false && (
            <div className="update-note">
              На этой платформе автоустановка недоступна: обновление нужно
              поставить вручную, заменив программу в папке «Программы».
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-ghost"
            onClick={onOpenReleases}
            title="Открыть страницу релизов в браузере"
          >
            Страница релизов
          </button>
          <div style={{ flex: 1 }} />
          {status.state === 'downloaded' ? (
            <button
              className="btn btn-primary"
              onClick={onInstall}
              disabled={!status.canInstall}
              title={
                status.canInstall
                  ? 'Программа закроется, обновится и запустится заново'
                  : 'Автоустановка на этой платформе недоступна'
              }
            >
              <RefreshCw size={16} />
              Установить и перезапустить
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onCheck} disabled={busy}>
              {status.state === 'checking' ? (
                <RefreshCw size={16} className="spin" />
              ) : (
                <Download size={16} />
              )}
              {status.state === 'checking' ? 'Проверяю…' : 'Проверить обновление'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface AddCategoryModalProps {
  categories: Category[];
  depositCategories: DepositCategory[];
  onClose: () => void;
  onAddCategory: (name: string) => void;
  onAddSubcategory: (categoryId: number, name: string) => void;
  onDeleteCategory: (id: number) => void;
  onDeleteSubcategory: (id: number) => void;
  onSetIcon: (id: number, icon: string | null) => void;
  onSetColor: (id: number, color: string | null) => void;
  onAddSubitem: (subcategoryId: number, name: string) => void;
  onDeleteSubitem: (id: number) => void;
  onAddDepositCategory: (name: string) => Promise<{ id: number; name: string }>;
  onDeleteDepositCategory: (id: number) => void;
  onSetDepositColor: (id: number, color: string | null) => void;
  /** Переименование. Возвращает промис, чтобы модалка могла дождаться ответа
   *  и показать ошибку прямо у поля, а не молча закрыться. */
  onRenameCategory: (id: number, name: string) => Promise<void>;
  onRenameSubcategory: (id: number, name: string) => Promise<void>;
  onRenameSubitem: (id: number, name: string) => Promise<void>;
  onRenameDepositCategory: (id: number, name: string) => Promise<void>;
  onMergeCategories: (targetId: number, sourceIds: number[]) => Promise<void>;
}

export function CategoryManagerModal({
  categories,
  depositCategories,
  onClose,
  onAddCategory,
  onAddSubcategory,
  onDeleteCategory,
  onDeleteSubcategory,
  onSetIcon,
  onSetColor,
  onAddSubitem,
  onDeleteSubitem,
  onAddDepositCategory,
  onDeleteDepositCategory,
  onSetDepositColor,
  onRenameCategory,
  onRenameSubcategory,
  onRenameSubitem,
  onRenameDepositCategory,
  onMergeCategories,
}: AddCategoryModalProps) {
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState<Record<number, string>>({});
  const [newSubitem, setNewSubitem] = useState<Record<number, string>>({});
  const [newDepositCategory, setNewDepositCategory] = useState('');
  const [iconPickerFor, setIconPickerFor] = useState<number | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const [depositColorFor, setDepositColorFor] = useState<number | null>(null);
  // Что сейчас переименовываем: ключ — уровень + id, значение — черновик названия.
  const [renaming, setRenaming] = useState<{ key: string; draft: string } | null>(null);
  const [renameError, setRenameError] = useState('');

  /**
   * Общий обработчик для всех четырёх уровней. Поле остаётся открытым при
   * ошибке — так пользователь видит, что именно не так, и может исправить
   * название на месте, а не начинать заново.
   */
  const submitRename =
    (run: (draft: string) => Promise<void>) =>
    async (e: React.FormEvent) => {
      e.preventDefault();
      const draft = (renaming?.draft ?? '').trim();
      if (!draft || !renaming) return;
      try {
        await run(draft);
        setRenaming(null);
        setRenameError('');
      } catch (err) {
        setRenameError(err instanceof Error ? err.message : 'Не удалось переименовать');
      }
    };

  const startRename = (key: string, current: string) => {
    setRenameError('');
    setRenaming({ key, draft: current });
  };

  // ——— Объединение категорий ———
  // Форма раскрывается по кнопке: объединение нужно редко, а постоянно
  // висящий список с чекбоксами мешал бы работать с категориями.
  const [mergeOpen, setMergeOpen] = useState(false);
  /** Главная категория: та, что останется */
  const [mergeTarget, setMergeTarget] = useState('');
  /** Что в неё переедет */
  const [mergeSources, setMergeSources] = useState<number[]>([]);
  const [mergeError, setMergeError] = useState('');

  const mergeable = categories.filter((c) => String(c.id) !== mergeTarget);

  const toggleMergeSource = (id: number) => {
    setMergeSources((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submitMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeTarget || mergeSources.length === 0) return;
    setMergeError('');
    try {
      await onMergeCategories(Number(mergeTarget), mergeSources);
      setMergeOpen(false);
      setMergeTarget('');
      setMergeSources([]);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Не удалось объединить категории');
    }
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    onAddCategory(name);
    setNewCategory('');
  };

  const handleAddSubcategory = (e: React.FormEvent, categoryId: number) => {
    e.preventDefault();
    const name = (newSubcategory[categoryId] || '').trim();
    if (!name) return;
    onAddSubcategory(categoryId, name);
    setNewSubcategory((prev) => ({ ...prev, [categoryId]: '' }));
  };

  const handleAddSubitem = (e: React.FormEvent, subcategoryId: number) => {
    e.preventDefault();
    const name = (newSubitem[subcategoryId] || '').trim();
    if (!name) return;
    onAddSubitem(subcategoryId, name);
    setNewSubitem((prev) => ({ ...prev, [subcategoryId]: '' }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Управление категориями</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        {renameError && (
          <div className="field-hint rename-error" role="alert">
            <AlertCircle size={14} />
            {renameError}
          </div>
        )}

        <div className="report-breakdown" style={{ marginTop: 0 }}>
          <div className="breakdown-title">Добавить категорию</div>
          <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <input
              type="text"
              placeholder="Название категории..."
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary">
              <Plus size={16} />
              Добавить
            </button>
          </form>

          <div className="breakdown-title">Категории и подкатегории</div>
          {categories.map((cat) => {
            const subs: Subcategory[] = Array.isArray(cat.subcategories)
              ? (cat.subcategories as Subcategory[])
              : [];
            return (
              <div key={cat.id} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <button
                    className="icon-pick-btn"
                    onClick={() =>
                      setIconPickerFor(iconPickerFor === cat.id ? null : cat.id)
                    }
                    title="Выбрать значок"
                    aria-label={`Значок категории ${cat.name}`}
                  >
                    {(() => {
                      const def = getCategoryIcon(cat.icon);
                      const Icon = def.Icon;
                      return (
                        <Icon
                          size={17}
                          style={{
                            color: def.color,
                            background: `${def.color}22`,
                            borderRadius: 6,
                            padding: 2,
                            boxSizing: 'content-box',
                          }}
                        />
                      );
                    })()}
                  </button>
                  <button
                    className="icon-pick-btn"
                    onClick={() =>
                      setColorPickerFor(colorPickerFor === cat.id ? null : cat.id)
                    }
                    title="Выбрать цвет для графика"
                    aria-label={`Цвет категории ${cat.name}`}
                    style={{
                      background: cat.color || 'var(--bg-card)',
                      borderColor: cat.color ? cat.color : 'var(--border-color)',
                    }}
                  />
                  {renaming?.key === `cat:${cat.id}` ? (
                    <form
                      className="rename-form"
                      onSubmit={submitRename((draft) => onRenameCategory(cat.id, draft))}
                    >
                      <input
                        className="rename-input"
                        autoFocus
                        value={renaming.draft}
                        onChange={(e) =>
                          setRenaming({ key: `cat:${cat.id}`, draft: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setRenaming(null);
                            setRenameError('');
                          }
                        }}
                      />
                      <button
                        type="submit"
                        className="action-btn"
                        title="Сохранить"
                        aria-label="Сохранить название"
                      >
                        <Check size={15} color="var(--accent-success)" />
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => {
                          setRenaming(null);
                          setRenameError('');
                        }}
                        title="Отмена"
                        aria-label="Отменить переименование"
                      >
                        <X size={15} />
                      </button>
                    </form>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{cat.name}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className="action-btn"
                    onClick={() => startRename(`cat:${cat.id}`, cat.name)}
                    title="Переименовать категорию"
                    aria-label={`Переименовать категорию ${cat.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="action-btn"
                    onClick={() => onDeleteCategory(cat.id)}
                    title="Удалить категорию вместе с тратами"
                  >
                    <Trash2 size={16} color="var(--accent-danger)" />
                  </button>
                </div>
              </div>

              {iconPickerFor === cat.id && (
                <div className="icon-picker">
                  <div className="icon-picker-grid">
                    {CATEGORY_ICONS.map((def) => {
                      const Icon = def.Icon;
                      const active = (cat.icon || 'cart') === def.key;
                      return (
                        <button
                          key={def.key}
                          className={`icon-picker-item ${active ? 'active' : ''}`}
                          onClick={() => {
                            onSetIcon(cat.id, def.key);
                            setIconPickerFor(null);
                          }}
                          title={def.label}
                          aria-label={def.label}
                        >
                          <Icon
                            size={18}
                            style={{
                              color: def.color,
                              background: `${def.color}22`,
                              borderRadius: 7,
                              padding: 3,
                              boxSizing: 'content-box',
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Палитра цвета — определяет цвет сектора на графике */}
              {colorPickerFor === cat.id && (
                <div className="icon-picker">
                  <div className="color-label">Цвет сектора на графике</div>
                  <div className="color-picker">
                    {CHART_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`color-swatch ${cat.color === c ? 'active' : ''}`}
                        style={{ background: c }}
                        onClick={() => {
                          onSetColor(cat.id, c);
                          setColorPickerFor(null);
                        }}
                        title={c}
                        aria-label={`Цвет ${c}`}
                      />
                    ))}
                  </div>
                </div>
              )}

                {subs.length > 0 && (
                  <div style={{ marginLeft: 16, marginTop: 8 }}>
                    {subs.map((sub) => {
                      const items: Subitem[] = Array.isArray(sub.items)
                        ? (sub.items as Subitem[])
                        : [];
                      return (
                        <div key={sub.id} style={{ marginBottom: 6 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 0',
                            }}
                          >
                            <div className="manage-cell">
                            {renaming?.key === `sub:${sub.id}` ? (
                              <form
                                className="rename-form"
                                onSubmit={submitRename((draft) =>
                                  onRenameSubcategory(sub.id, draft)
                                )}
                              >
                                <input
                                  className="rename-input"
                                  style={{ fontSize: 13 }}
                                  autoFocus
                                  value={renaming.draft}
                                  onChange={(e) =>
                                    setRenaming({ key: `sub:${sub.id}`, draft: e.target.value })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      setRenaming(null);
                                      setRenameError('');
                                    }
                                  }}
                                />
                                <button
                                  type="submit"
                                  className="action-btn"
                                  title="Сохранить"
                                  aria-label="Сохранить название"
                                >
                                  <Check size={13} color="var(--accent-success)" />
                                </button>
                                <button
                                  type="button"
                                  className="action-btn"
                                  onClick={() => {
                                    setRenaming(null);
                                    setRenameError('');
                                  }}
                                  title="Отмена"
                                  aria-label="Отменить переименование"
                                >
                                  <X size={13} />
                                </button>
                              </form>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                                {sub.name}
                              </span>
                            )}
                          </div>
                          <div className="manage-actions">
                            <button
                              className="action-btn"
                              onClick={() => startRename(`sub:${sub.id}`, sub.name)}
                              title="Переименовать подкатегорию"
                              aria-label={`Переименовать подкатегорию ${sub.name}`}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="action-btn"
                              onClick={() => onDeleteSubcategory(sub.id)}
                              title="Удалить подкатегорию вместе с тратами"
                            >
                              <Trash2 size={14} color="var(--accent-danger)" />
                            </button>
                          </div>
                          </div>

                          {/* Третий уровень — статьи */}
                          {items.length > 0 && (
                            <div style={{ marginLeft: 14, paddingLeft: 10, borderLeft: '2px solid var(--border-color)' }}>
                              {items.map((item) => (
                                <div
                                  key={item.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '4px 0',
                                  }}
                                >
                                  <div className="manage-cell">
                                    {renaming?.key === `item:${item.id}` ? (
                                      <form
                                        className="rename-form"
                                        onSubmit={submitRename((draft) =>
                                          onRenameSubitem(item.id, draft)
                                        )}
                                      >
                                        <input
                                          className="rename-input"
                                          style={{ fontSize: 12 }}
                                          autoFocus
                                          value={renaming.draft}
                                          onChange={(e) =>
                                            setRenaming({
                                              key: `item:${item.id}`,
                                              draft: e.target.value,
                                            })
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === 'Escape') {
                                              setRenaming(null);
                                              setRenameError('');
                                            }
                                          }}
                                        />
                                        <button
                                          type="submit"
                                          className="action-btn"
                                          title="Сохранить"
                                          aria-label="Сохранить название"
                                        >
                                          <Check size={12} color="var(--accent-success)" />
                                        </button>
                                        <button
                                          type="button"
                                          className="action-btn"
                                          onClick={() => {
                                            setRenaming(null);
                                            setRenameError('');
                                          }}
                                          title="Отмена"
                                          aria-label="Отменить переименование"
                                        >
                                          <X size={12} />
                                        </button>
                                      </form>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                        {item.name}
                                      </span>
                                    )}
                                  </div>
                                  <div className="manage-actions">
                                    <button
                                      className="action-btn"
                                      onClick={() => startRename(`item:${item.id}`, item.name)}
                                      title="Переименовать статью"
                                      aria-label={`Переименовать статью ${item.name}`}
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      className="action-btn"
                                      onClick={() => onDeleteSubitem(item.id)}
                                      title="Удалить статью вместе с тратами"
                                    >
                                      <Trash2 size={12} color="var(--accent-danger)" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <form
                            onSubmit={(e) => handleAddSubitem(e, sub.id)}
                            style={{ display: 'flex', gap: 6, marginLeft: 14, marginTop: 4 }}
                          >
                            <input
                              type="text"
                              placeholder={`Статья для "${sub.name}"...`}
                              value={newSubitem[sub.id] || ''}
                              onChange={(e) =>
                                setNewSubitem((prev) => ({ ...prev, [sub.id]: e.target.value }))
                              }
                              style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
                            />
                            <button
                              type="submit"
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                              <Plus size={12} />
                            </button>
                          </form>
                        </div>
                      );
                    })}
                  </div>
                )}

                <form
                  onSubmit={(e) => handleAddSubcategory(e, cat.id)}
                  style={{ display: 'flex', gap: 8, marginTop: 8, marginLeft: 16 }}
                >
                  <input
                    type="text"
                    placeholder={`Подкатегория для "${cat.name}"...`}
                    value={newSubcategory[cat.id] || ''}
                    onChange={(e) =>
                      setNewSubcategory((prev) => ({ ...prev, [cat.id]: e.target.value }))
                    }
                    style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                  >
                    <Plus size={14} />
                  </button>
                </form>
              </div>
            );
          })}
        </div>

        {/* Категории внесений живут отдельным справочником: они пришли из
            прежних комментариев и не имеют ничего общего с категориями трат */}
        <div className="section-divider" />

        {/* Объединение категорий */}
        <div className="section-divider" />

        {mergeOpen ? (
          <form className="merge-form" onSubmit={submitMerge}>
            <div className="breakdown-title">Объединить категории</div>

            <label className="form-group">
              <span className="form-label">Оставить (основная категория)</span>
              <select
                value={mergeTarget}
                onChange={(e) => {
                  setMergeTarget(e.target.value);
                  setMergeSources([]);
                }}
              >
                <option value="">— выбрать —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {mergeTarget && (
              <>
                <div className="field-hint" style={{ marginBottom: 6 }}>
                  Перенести в неё:
                </div>
                <div className="merge-picker">
                  {mergeable.map((c) => {
                    const checked = mergeSources.includes(c.id);
                    const subs = Array.isArray(c.subcategories)
                      ? (c.subcategories as Subcategory[]).length
                      : 0;
                    return (
                      <label key={c.id} className={`merge-option ${checked ? 'checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMergeSource(c.id)}
                        />
                        <span>{c.name}</span>
                        {subs > 0 && <span className="merge-option-sub">{subs} подк.</span>}
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {mergeTarget && mergeSources.length > 0 && (
              <div className="field-hint">
                Подкатегории и траты переедут в «
                {categories.find((c) => String(c.id) === mergeTarget)?.name}». Совпадающие
                подкатегории сольются в одну. Траты останутся на месте — объединение
                ничего не удаляет из истории.
              </div>
            )}

            {mergeError && <div className="form-error">{mergeError}</div>}

            <div className="recurring-form-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setMergeOpen(false);
                  setMergeTarget('');
                  setMergeSources([]);
                  setMergeError('');
                }}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!mergeTarget || mergeSources.length === 0}
              >
                Объединить
              </button>
            </div>
          </form>
        ) : (
          <button className="recurring-add-trigger" onClick={() => setMergeOpen(true)}>
            <GitMerge size={16} />
            Объединить категории
          </button>
        )}

        <div className="section-divider" />

        <div className="section-title">Категории внесений</div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Откуда пришли деньги. Раньше это был свободный комментарий — теперь
          одинаковые комментарии объединены в одну категорию. Переименуйте
          карандашом, удаление убирает вместе с категорией и её внесения.
        </div>

        <div className="category-list-manage">
          {depositCategories.length === 0 && (
            <div className="empty-hint">Пока нет ни одной категории внесений</div>
          )}
          {depositCategories.map((c) => (
            <div key={c.id} className="manage-row">
              <button
                className="icon-pick-btn"
                onClick={() =>
                  setDepositColorFor(depositColorFor === c.id ? null : c.id)
                }
                title="Выбрать цвет для графика прихода"
                aria-label={`Цвет категории внесения ${c.name}`}
                style={{
                  background: c.color || 'var(--bg-card)',
                  borderColor: c.color ? c.color : 'var(--border-color)',
                }}
              />
              <div className="manage-cell">
                {renaming?.key === `dep:${c.id}` ? (
                  <form
                    className="rename-form"
                    onSubmit={submitRename((draft) => onRenameDepositCategory(c.id, draft))}
                  >
                    <input
                      className="rename-input"
                      autoFocus
                      value={renaming.draft}
                      onChange={(e) => setRenaming({ key: `dep:${c.id}`, draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setRenaming(null);
                          setRenameError('');
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className="action-btn"
                      title="Сохранить"
                      aria-label="Сохранить название"
                    >
                      <Check size={14} color="var(--accent-success)" />
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => {
                        setRenaming(null);
                        setRenameError('');
                      }}
                      title="Отмена"
                      aria-label="Отменить переименование"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <span className="manage-name">{c.name}</span>
                )}
              </div>
              <span className="manage-count">
                {c.deposits_count ?? 0} внес.
              </span>
              <div className="manage-actions">
                <button
                  className="action-btn"
                  onClick={() => startRename(`dep:${c.id}`, c.name)}
                  title="Переименовать категорию внесений"
                  aria-label={`Переименовать категорию внесений ${c.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="action-btn"
                  onClick={() => onDeleteDepositCategory(c.id)}
                  title={
                    (c.deposits_count ?? 0) > 0
                      ? `Удалить категорию вместе с ${c.deposits_count} внесениями. Остаток уменьшится на их сумму.`
                      : 'Удалить категорию'
                  }
                >
                  <Trash2 size={14} color="var(--accent-danger)" />
                </button>
              </div>

              {depositColorFor === c.id && (
                <div className="color-picker deposit-color-picker">
                  {CHART_COLORS.map((col) => (
                    <button
                      key={col}
                      className={`color-swatch ${c.color === col ? 'active' : ''}`}
                      style={{ background: col }}
                      onClick={() => {
                        onSetDepositColor(c.id, col);
                        setDepositColorFor(null);
                      }}
                      title={col}
                      aria-label={`Цвет ${col}`}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          <form
            className="inline-create"
            style={{ marginTop: 10 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newDepositCategory.trim();
              if (!name) return;
              try {
                await onAddDepositCategory(name);
                setNewDepositCategory('');
              } catch {
                /* обработка — в App.tsx через addToast */
              }
            }}
          >
            <input
              type="text"
              placeholder="Новая категория внесения…"
              value={newDepositCategory}
              onChange={(e) => setNewDepositCategory(e.target.value)}
              maxLength={120}
            />
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={!newDepositCategory.trim()}
            >
              <Plus size={14} />
              Добавить
            </button>
          </form>
        </div>

        <div className="modal-footer">
          <span
            style={{
              marginRight: 'auto',
              fontSize: 12,
              color: 'var(--text-muted)',
              alignSelf: 'center',
            }}
          >
            Траты Сани v{__APP_VERSION__}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{message}</p>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}