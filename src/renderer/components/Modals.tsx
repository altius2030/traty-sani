import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Banknote } from 'lucide-react';
import type { Category, Subcategory } from '../types';
import { toISODate } from '../lib/format';
import { CATEGORY_ICONS, getCategoryIcon } from '../lib/icons';

interface AddExpenseModalProps {
  categories: Category[];
  preselectedCategoryId?: number | null;
  onClose: () => void;
  onSubmit: (data: {
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    date: string;
    note?: string;
  }) => void;
}

interface AddExpenseModalProps {
  categories: Category[];
  preselectedCategoryId?: number | null;
  /** Подкатегория, выбранная в боковой панели — подставляется сразу */
  preselectedSubcategoryId?: number | null;
  onClose: () => void;
  onSubmit: (data: {
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    date: string;
    note?: string;
  }) => void;
}

export default function AddExpenseModal({
  categories,
  preselectedCategoryId,
  preselectedSubcategoryId,
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
  }, [categoryId]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const subcategories: Subcategory[] = Array.isArray(selectedCategory?.subcategories)
    ? (selectedCategory?.subcategories as Subcategory[])
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (!categoryId || isNaN(amountNum) || amountNum <= 0) return;
    onSubmit({
      categoryId,
      subcategoryId: subcategoryId ? Number(subcategoryId) : undefined,
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
  onClose: () => void;
  onSubmit: (data: { amount: number; date: string; note: string }) => void;
}

/**
 * Внесение денег. Комментарий обязателен — без него внесение не сохраняется.
 * Проверка дублируется на сервере (см. db:addDeposit) и в БД (CHECK).
 */
export function AddDepositModal({ onClose, onSubmit }: AddDepositModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [noteTouched, setNoteTouched] = useState(false);
  const [error, setError] = useState('');

  const amountNum = parseFloat(amount.replace(',', '.'));
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const noteValid = note.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountValid || !noteValid) return;
    onSubmit({ amount: amountNum, date, note: note.trim() });
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
            <label className="form-label" htmlFor="deposit-note">
              Комментарий <span style={{ color: 'var(--accent-danger)' }}>*</span>
            </label>
            <textarea
              id="deposit-note"
              rows={3}
              placeholder="Обязательно: откуда деньги, например «Пополнение с карты» или «Выручка за заказ»"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (noteTouched) setError('');
              }}
              onBlur={() => setNoteTouched(true)}
              maxLength={500}
              required
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            {noteTouched && !noteValid ? (
              <div className="field-error">Комментарий обязателен к внесению</div>
            ) : (
              <div className="field-hint">
                Комментарий обязателен — он попадёт в отчёт за период.
              </div>
            )}
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!amountValid || !noteValid}
              title={
                !amountValid
                  ? 'Укажите сумму больше нуля'
                  : !noteValid
                  ? 'Укажите комментарий'
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
  onClose: () => void;
  onAddCategory: (name: string) => void;
  onAddSubcategory: (categoryId: number, name: string) => void;
  onDeleteCategory: (id: number) => void;
  onDeleteSubcategory: (id: number) => void;
  onSetIcon: (id: number, icon: string | null) => void;
}

export function CategoryManagerModal({
  categories,
  onClose,
  onAddCategory,
  onAddSubcategory,
  onDeleteCategory,
  onDeleteSubcategory,
  onSetIcon,
}: AddCategoryModalProps) {
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState<Record<number, string>>({});
  const [iconPickerFor, setIconPickerFor] = useState<number | null>(null);

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

                {subs.length > 0 && (
                  <div style={{ marginLeft: 16, marginTop: 8 }}>
                    {subs.map((sub) => (
                      <div
                        key={sub.id}
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
                    ))}
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