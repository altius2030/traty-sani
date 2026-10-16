import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Banknote } from 'lucide-react';
import type { Category, Subcategory, Subitem, DepositCategory } from '../types';
import { toISODate } from '../lib/format';
import { CATEGORY_ICONS, getCategoryIcon, CHART_COLORS } from '../lib/icons';

interface AddExpenseModalProps {
  categories: Category[];
  preselectedCategoryId?: number | null;
  /** Подкатегория, выбранная в боковой панели — подставляется сразу */
  preselectedSubcategoryId?: number | null;
  /** Статья третьего уровня, выбранная в боковой панели */
  preselectedSubitemId?: number | null;
  onClose: () => void;
  onSubmit: (data: {
    categoryId: number;
    subcategoryId?: number;
    subitemId?: number;
    amount: number;
    date: string;
    note?: string;
  }) => void;
}

export default function AddExpenseModal({
  categories,
  preselectedCategoryId,
  preselectedSubcategoryId,
  preselectedSubitemId,
  onClose,
  onSubmit,
}: AddExpenseModalProps) {
  const [categoryId, setCategoryId] = useState<number>(
    preselectedCategoryId ?? categories[0]?.id ?? 0
  );
  const [subcategoryId, setSubcategoryId] = useState<number | ''>(
    preselectedSubcategoryId ?? ''
  );
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [subitemId, setSubitemId] = useState<number | ''>(preselectedSubitemId ?? '');

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

  // Смена подкатегории сбрасывает статью — она принадлежит другой ветке
  useEffect(() => {
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
  onSubmit: (data: { amount: number; date: string; categoryId: number }) => void;
  /** Создание новой категории прямо из формы */
  onAddCategory: (name: string) => Promise<{ id: number; name: string }>;
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
}: AddDepositModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [categoryId, setCategoryId] = useState<number | ''>('');
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
    onSubmit({ amount: amountNum, date, categoryId: Number(categoryId) });
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
  onSubmit: (data: { amount: number; date: string; note?: string }) => void;
}

export function AddBalanceModal({ onClose, onSubmit }: AddBalanceModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountNum)) return;
    onSubmit({
      amount: amountNum,
      date,
      note: note.trim() || undefined,
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
}: AddCategoryModalProps) {
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState<Record<number, string>>({});
  const [newSubitem, setNewSubitem] = useState<Record<number, string>>({});
  const [newDepositCategory, setNewDepositCategory] = useState('');
  const [iconPickerFor, setIconPickerFor] = useState<number | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const [depositColorFor, setDepositColorFor] = useState<number | null>(null);

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
                  <span style={{ fontWeight: 600 }}>{cat.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className="action-btn"
                    onClick={() => onDeleteCategory(cat.id)}
                    title="Удалить категорию"
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
                            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                              {sub.name}
                            </span>
                            <button
                              className="action-btn"
                              onClick={() => onDeleteSubcategory(sub.id)}
                              title="Удалить подкатегорию"
                            >
                              <Trash2 size={14} color="var(--accent-danger)" />
                            </button>
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
                                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                    {item.name}
                                  </span>
                                  <button
                                    className="action-btn"
                                    onClick={() => onDeleteSubitem(item.id)}
                                    title="Удалить статью"
                                  >
                                    <Trash2 size={12} color="var(--accent-danger)" />
                                  </button>
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

        <div className="section-title">Категории внесений</div>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Откуда пришли деньги. Раньше это был свободный комментарий — теперь
          одинаковые комментарии объединены в одну категорию.
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
              <span className="manage-name">{c.name}</span>
              <span className="manage-count">
                {c.deposits_count ?? 0} внес.
              </span>
              <button
                className="action-btn"
                onClick={() => onDeleteDepositCategory(c.id)}
                title={
                  (c.deposits_count ?? 0) > 0
                    ? `Удалить категорию. ${c.deposits_count} внесений сохранятся, но останутся без категории.`
                    : 'Удалить категорию'
                }
              >
                <Trash2 size={14} color="var(--accent-danger)" />
              </button>

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