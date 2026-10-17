import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Check,
  Repeat,
  Pencil,
  CalendarDays,
} from 'lucide-react';
import type {
  Category,
  RecurringItem,
  RecurringFrequency,
  DepositCategory,
} from '../types';
import { RECURRING_FREQUENCIES, frequencyLabel } from '../types';
import { formatMoney, toISODate } from '../lib/format';
import { getCategoryIcon as getCategoryIconDef } from '../lib/icons';

/** Сегодняшняя дата как YYYY-MM-DD — граница, после которой платёж просрочен */
function todayISO(): string {
  return toISODate(new Date());
}

/** Склонение: 1 день, 2 дня, 5 дней */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/**
 * Человеческая подпись срока: «сегодня», «через 3 дня», «просрочен на 5 дней».
 * Для ежедневных платежей подпись не нужна — они наступают всегда.
 */
function dueLabel(item: RecurringItem, today: string): { text: string; overdue: boolean } {
  const diffDays = Math.round(
    (new Date(item.next_date).getTime() - new Date(today).getTime()) / 86400000
  );

  if (diffDays === 0) return { text: 'сегодня', overdue: false };
  if (diffDays < 0) {
    return { text: `просрочен на ${pluralDays(Math.abs(diffDays))}`, overdue: true };
  }
  if (diffDays === 1) return { text: 'завтра', overdue: false };
  return { text: `через ${pluralDays(diffDays)}`, overdue: false };
}

interface PayButtonProps {
  item: RecurringItem;
  onPay: (id: number) => void;
  compact?: boolean;
}

function PayButton({ item, onPay, compact }: PayButtonProps) {
  return (
    <button
      className={`recurring-pay ${compact ? 'compact' : ''}`}
      onClick={() => onPay(item.id)}
      title={`Создать трату «${item.title}» на ${formatMoney(item.amount)}`}
    >
      <Check size={compact ? 13 : 14} />
      {compact ? '' : 'Оплачено'}
    </button>
  );
}

// ——— Блок в боковой панели ———

interface RecurringBlockProps {
  items: RecurringItem[];
  monthlyTotal: number;
  onPay: (id: number) => void;
  onOpenManager: () => void;
}

export function RecurringBlock({
  items,
  monthlyTotal,
  onPay,
  onOpenManager,
}: RecurringBlockProps) {
  const today = todayISO();
  if (items.length === 0 && monthlyTotal <= 0) return null;

  const overdue = items.filter((i) => i.next_date < today).length;

  return (
    <div className="recurring-block">
      <div className="sidebar-section-title recurring-block-head">
        <span>
          <Repeat size={13} />
          Пора оплатить
          {overdue > 0 && <span className="recurring-overdue">{overdue}</span>}
        </span>
        <button
          className="recurring-manage"
          onClick={onOpenManager}
          title="Все регулярные платежи"
        >
          все
        </button>
      </div>

      {items.length === 0 && (
        <div className="recurring-empty">
          Всё оплачено до {formatMoney(monthlyTotal)} в месяц
        </div>
      )}

      {items.map((item) => {
        const label = dueLabel(item, today);
        return (
          <div key={item.id} className={`recurring-item ${label.overdue ? 'overdue' : ''}`}>
            <div className="recurring-item-main">
              <div className="recurring-item-title">{item.title}</div>
              <div className="recurring-item-meta">
                {label.text} · {frequencyLabel(item.frequency)}
              </div>
            </div>
            <div className="recurring-item-right">
              <div className="recurring-item-amount">{formatMoney(item.amount)}</div>
              <PayButton item={item} onPay={onPay} compact />
            </div>
          </div>
        );
      })}

      {monthlyTotal > 0 && (
        <div className="recurring-total">
          Постоянные расходы: <strong>{formatMoney(monthlyTotal)}</strong> в месяц
        </div>
      )}
    </div>
  );
}

// ——— Окно управления ———

interface RecurringModalProps {
  categories: Category[];
  items: RecurringItem[];
  monthlyTotal: number;
  onClose: () => void;
  onAdd: (payload: {
    title: string;
    categoryId: number;
    subcategoryId?: number;
    amount: number;
    frequency: RecurringFrequency;
    nextDate: string;
  }) => Promise<{ success: boolean; message?: string }>;
  onUpdate: (
    id: number,
    patch: Partial<{
      title: string;
      amount: number;
      frequency: RecurringFrequency;
      nextDate: string;
      isActive: boolean;
    }>
  ) => Promise<{ success: boolean; message?: string }>;
  onDelete: (id: number) => void;
  onPay: (id: number) => void;
}

interface FormState {
  title: string;
  categoryId: number | '';
  subcategoryId: number | '';
  amount: string;
  frequency: RecurringFrequency;
  nextDate: string;
}

const emptyForm = (): FormState => ({
  title: '',
  categoryId: '',
  subcategoryId: '',
  amount: '',
  frequency: 'monthly',
  nextDate: todayISO(),
});

export function RecurringModal({
  categories,
  items,
  monthlyTotal,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
  onPay,
}: RecurringModalProps) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const subcategories: DepositCategory[] = Array.isArray(selectedCategory?.subcategories)
    ? (selectedCategory?.subcategories as unknown as DepositCategory[])
    : [];

  const amountNum = Number(form.amount.replace(',', '.'));
  const valid =
    form.title.trim() !== '' &&
    form.categoryId !== '' &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    form.nextDate !== '';

  // Смена категории сбрасывает подкатегорию: она принадлежит другой ветке
  useEffect(() => {
    setForm((f) => ({ ...f, subcategoryId: '' }));
  }, [form.categoryId]);

  const startEdit = (item: RecurringItem) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      categoryId: item.category_id,
      subcategoryId: item.subcategory_id ?? '',
      amount: String(item.amount),
      frequency: item.frequency,
      nextDate: item.next_date,
    });
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError('');

    const payload = {
      title: form.title.trim(),
      amount: amountNum,
      frequency: form.frequency,
      nextDate: form.nextDate,
    };

    const res = editingId
      ? await onUpdate(editingId, payload)
      : await onAdd({
          ...payload,
          categoryId: form.categoryId as number,
          subcategoryId: form.subcategoryId === '' ? undefined : (form.subcategoryId as number),
        });

    if (!res.success) {
      setError(res.message || 'Не удалось сохранить платёж');
      return;
    }
    cancelEdit();
  };

  // Постоянные расходы пересчитываются на сервере, но показываем то, что
  // пришло с ним же — иначе сумма в шапке разошлась бы со списком
  const active = useMemo(() => items.filter((i) => i.is_active === 1), [items]);
  const inactive = useMemo(() => items.filter((i) => i.is_active !== 1), [items]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal recurring-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Repeat size={18} />
            Регулярные платежи
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <CalendarDays size={20} />
          </button>
        </div>

        <div className="recurring-modal-body">
          {items.length === 0 ? (
            <div className="recurring-modal-empty">
              Пока ничего не задано. Добавьте аренду, связь, подписки — и программа
              будет напоминать о них сама.
            </div>
          ) : (
            <>
              {monthlyTotal > 0 && (
                <div className="recurring-modal-total">
                  Постоянные расходы:{' '}
                  <strong>{formatMoney(monthlyTotal)}</strong> в месяц
                </div>
              )}

              <div className="recurring-list">
                {[...active, ...inactive].map((item) => {
                  const def = getCategoryIconDef(item.category_icon);
                  const I = def.Icon;
                  const off = item.is_active !== 1;
                  return (
                    <div key={item.id} className={`recurring-row ${off ? 'off' : ''}`}>
                      <div
                        className="recurring-row-icon"
                        style={{ background: `${def.color}22`, color: def.color }}
                      >
                        <I size={15} />
                      </div>

                      <div className="recurring-row-main">
                        <div className="recurring-row-title">
                          {item.title}
                          {off && <span className="recurring-off-badge">выключен</span>}
                        </div>
                        <div className="recurring-row-meta">
                          {item.category_name}
                          {item.subcategory_name ? ` · ${item.subcategory_name}` : ''} ·{' '}
                          {frequencyLabel(item.frequency)} · с {item.next_date}
                        </div>
                      </div>

                      <div className="recurring-row-amount">{formatMoney(item.amount)}</div>

                      <div className="recurring-row-actions">
                        {!off && <PayButton item={item} onPay={onPay} compact />}
                        <button
                          className="action-btn"
                          onClick={() =>
                            onUpdate(item.id, { isActive: off })
                          }
                          title={off ? 'Включить' : 'Выключить'}
                        >
                          <Check size={15} />
                        </button>
                        <button
                          className="action-btn"
                          onClick={() => startEdit(item)}
                          title="Изменить"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="action-btn"
                          onClick={() => onDelete(item.id)}
                          title="Удалить"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <form className="recurring-form" onSubmit={submit}>
            <div className="recurring-form-title">
              {editingId ? 'Изменить платёж' : 'Новый платёж'}
            </div>

            <div className="form-row">
              <label className="form-group recurring-field-wide">
                <span>Название</span>
                <input
                  type="text"
                  value={form.title}
                  placeholder="Аренда, связь, Netflix…"
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
            </div>

            <div className="form-row">
              <label className="form-group">
                <span>Категория</span>
                <select
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      categoryId: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                >
                  <option value="">— выбрать —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-group">
                <span>Подкатегория</span>
                <select
                  value={form.subcategoryId}
                  disabled={subcategories.length === 0}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subcategoryId: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                >
                  <option value="">— нет —</option>
                  {subcategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-row">
              <label className="form-group">
                <span>Сумма (₸)</span>
                <input
                  type="number"
                  value={form.amount}
                  placeholder="15000"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </label>

              <label className="form-group">
                <span>Повтор</span>
                <select
                  value={form.frequency}
                  onChange={(e) =>
                    setForm({ ...form, frequency: e.target.value as RecurringFrequency })
                  }
                >
                  {RECURRING_FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-group">
                <span>Первый платёж</span>
                <input
                  type="date"
                  value={form.nextDate}
                  onChange={(e) => setForm({ ...form, nextDate: e.target.value })}
                />
              </label>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="recurring-form-actions">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Отмена
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={!valid}>
                {editingId ? <Check size={16} /> : <Plus size={16} />}
                {editingId ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}