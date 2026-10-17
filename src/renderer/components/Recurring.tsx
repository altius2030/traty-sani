import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Check,
  Repeat,
  Pencil,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import type {
  Category,
  RecurringItem,
  RecurringFrequency,
  RecurringOccurrence,
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

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface PayButtonProps {
  title: string;
  amount: number;
  onPay: () => void;
  compact?: boolean;
}

function PayButton({ title, amount, onPay, compact }: PayButtonProps) {
  return (
    <button
      className={`recurring-pay ${compact ? 'compact' : ''}`}
      onClick={onPay}
      title={`Создать трату «${title}» на ${formatMoney(amount)}`}
    >
      <Check size={compact ? 13 : 14} />
      {compact ? '' : 'Оплачено'}
    </button>
  );
}

// ——— Календарь ———

interface CalendarViewProps {
  occurrences: RecurringOccurrence[];
  onPayByTitle: (title: string, amount: number) => void;
  /** Показываемый месяц держится в родителе: от него зависит загрузка данных */
  year: number;
  month: number;
  onShiftMonth: (delta: number) => void;
}

/**
 * Календарь с платежами.
 *
 * Даты приходят с сервера — те же самые, что используются при отметке
 * «оплачено», поэтому кнопка в ячейке создаёт ровно ту трату, которую
 * показали. Отмечать оплатой прямо отсюда можно только платёж, который
 * реально наступил (дата не позже сегодняшней): отметить будущее — значит
 * внести платёж задним числом, а это уже решение пользователя.
 */
function CalendarView({
  occurrences,
  onPayByTitle,
  year,
  month,
  onShiftMonth,
}: CalendarViewProps) {
  const today = todayISO();
  const [selected, setSelected] = useState<string>(todayISO());

  // При смене месяца выделение переносим внутрь него: иначе подсветка
  // осталась бы на сегодняшнем дне, которого в новой сетке может не быть,
  // и панель снизу показывала бы чужую дату
  useEffect(() => {
    const today = todayISO();
    const monthStart = new Date(year, month, 1).getTime();
    const monthEnd = new Date(year, month + 1, 0).getTime();
    const todayTime = new Date(today).getTime();
    setSelected(
      todayTime >= monthStart && todayTime <= monthEnd
        ? today
        : `${year}-${pad(month + 1)}-01`
    );
  }, [year, month]);

  const byDate = useMemo(() => {
    const map = new Map<string, RecurringOccurrence[]>();
    for (const o of occurrences) {
      const list = map.get(o.date);
      if (list) list.push(o);
      else map.set(o.date, [o]);
    }
    return map;
  }, [occurrences]);

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTotal = occurrences.reduce((sum, o) => sum + o.amount, 0);
  const selectedItems = byDate.get(selected) ?? [];

  return (
    <div className="recurring-calendar">
      <div className="recurring-calendar-head">
        <button
          className="action-btn"
          onClick={() => onShiftMonth(-1)}
          title="Предыдущий месяц"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="recurring-calendar-title">
          {MONTHS[month]} {year}
          <span className="recurring-calendar-total">
            {monthTotal > 0 ? `${formatMoney(monthTotal)} за месяц` : 'платежей нет'}
          </span>
        </div>
        <button
          className="action-btn"
          onClick={() => onShiftMonth(1)}
          title="Следующий месяц"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="recurring-calendar-weekdays">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="recurring-calendar-grid">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="recurring-cell empty" />;
          }
          const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
          const items = byDate.get(iso) ?? [];
          const isToday = iso === today;
          const isSelected = iso === selected;
          const isPast = iso < today;

          return (
            <button
              key={iso}
              className={[
                'recurring-cell',
                isToday ? 'today' : '',
                isSelected ? 'selected' : '',
                items.length > 0 ? 'has' : '',
                isPast && items.length === 0 ? 'past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelected(iso)}
            >
              <span className="recurring-cell-day">{day}</span>
              {items.length > 0 && (
                <span className="recurring-cell-dots">
                  {items.slice(0, 4).map((o, idx) => (
                    <i
                      key={idx}
                      style={{ background: o.category_color ?? 'var(--accent-primary)' }}
                      title={o.title}
                    />
                  ))}
                  {items.length > 4 && <em>+{items.length - 4}</em>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="recurring-calendar-day">
        <div className="recurring-calendar-day-title">
          {new Date(selected).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
          })}
        </div>

        {selectedItems.length === 0 ? (
          <div className="recurring-calendar-day-empty">На этот день платежей нет</div>
        ) : (
          selectedItems.map((o, idx) => (
            <div key={idx} className="recurring-calendar-day-item">
              <span
                className="recurring-row-icon"
                style={{ background: `${o.category_color ?? 'var(--accent-primary)'}22` }}
              >
                <i
                  style={{
                    background: o.category_color ?? 'var(--accent-primary)',
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                  }}
                />
              </span>
              <div className="recurring-row-main">
                <div className="recurring-row-title">{o.title}</div>
                <div className="recurring-row-meta">{o.category_name}</div>
              </div>
              <div className="recurring-row-amount">{formatMoney(o.amount)}</div>
              {selected <= today && (
                <PayButton
                  title={o.title}
                  amount={o.amount}
                  compact
                  onPay={() => onPayByTitle(o.title, o.amount)}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
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
              <PayButton
                title={item.title}
                amount={item.amount}
                onPay={() => onPay(item.id)}
                compact
              />
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
  /** Платит платёж, найденный по названию — используется из календаря */
  onPayByTitle: (title: string, amount: number) => void;
  loadCalendar: (startDate: string, endDate: string) => Promise<RecurringOccurrence[]>;
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
  onPayByTitle,
  loadCalendar,
}: RecurringModalProps) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  /**
   * Форма свёрнута по умолчанию. Постоянно висящая форма занимала бы
   * пол-окна, когда платежей нет, и отвлекала бы от списка, когда они есть.
   */
  const [formOpen, setFormOpen] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calendar, setCalendar] = useState<RecurringOccurrence[]>([]);

  // Показываемый месяц календаря держим здесь, а не внутри CalendarView:
  // от него зависит запрос данных, и дочерний компонент, сменив месяц,
  // сам бы их не перезапросил
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const shiftCalendarMonth = useCallback((delta: number) => {
    setCalMonth((prev) => {
      const next = prev + delta;
      if (next < 0) {
        setCalYear((y) => y - 1);
        return 11;
      }
      if (next > 11) {
        setCalYear((y) => y + 1);
        return 0;
      }
      return next;
    });
  }, []);

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

  // Календарь грузится только когда он открыт, и перезапрашивается при
  // смене месяца. Без calYear/calMonth в зависимостях стрелка «вперёд»
  // перерисовала бы заголовок, оставив сетку с прошлого месяца
  useEffect(() => {
    if (view !== 'calendar') return;
    let cancelled = false;
    (async () => {
      const start = toISODate(new Date(calYear, calMonth, 1));
      const end = toISODate(new Date(calYear, calMonth + 1, 0));
      const data = await loadCalendar(start, end);
      if (!cancelled) setCalendar(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [view, calYear, calMonth, loadCalendar]);

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
    setFormOpen(true);
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(false);
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
          subcategoryId:
            form.subcategoryId === '' ? undefined : (form.subcategoryId as number),
        });

    if (!res.success) {
      setError(res.message || 'Не удалось сохранить платёж');
      return;
    }
    cancelEdit();
  };

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
          <div className="recurring-header-actions">
            <button
              className={`action-btn ${view === 'calendar' ? 'active' : ''}`}
              onClick={() => setView(view === 'calendar' ? 'list' : 'calendar')}
              title={
                view === 'calendar'
                  ? 'К списку платежей'
                  : 'Календарь платежей'
              }
            >
              {view === 'calendar' ? <X size={16} /> : <CalendarDays size={16} />}
            </button>
            <button className="modal-close" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="recurring-modal-body">
          {/* Форма всегда сверху и свёрнута, пока её не открыли */}
          {formOpen ? (
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
                    autoFocus
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
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={!valid}>
                  {editingId ? <Check size={16} /> : <Plus size={16} />}
                  {editingId ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </form>
          ) : (
            <button className="recurring-add-trigger" onClick={() => setFormOpen(true)}>
              <Plus size={16} />
              Новый платёж
            </button>
          )}

          {view === 'calendar' && (
            <CalendarView
              occurrences={calendar}
              onPayByTitle={onPayByTitle}
              year={calYear}
              month={calMonth}
              onShiftMonth={shiftCalendarMonth}
            />
          )}

          {items.length === 0 ? (
            <div className="recurring-modal-empty">
              Пока ничего не задано. Добавьте аренду, связь, подписки — и
              программа будет напоминать о них сама.
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

                          <div className="recurring-row-amount">
                            {formatMoney(item.amount)}
                          </div>

                          <div className="recurring-row-actions">
                            {!off && (
                              <PayButton
                                title={item.title}
                                amount={item.amount}
                                compact
                                onPay={() => onPay(item.id)}
                              />
                            )}
                            <button
                              className="action-btn"
                              onClick={() => onUpdate(item.id, { isActive: off })}
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
        </div>
      </div>
    </div>
  );
}