import { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Check,
  Pencil,
  X,
  HandCoins,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import type {
  Category,
  DepositCategory,
  LoanItem,
  RecurringFrequency,
  RecurringIncomeItem,
} from '../types';
import { RECURRING_FREQUENCIES, frequencyLabel } from '../types';
import { formatMoney, toISODate } from '../lib/format';

function todayISO(): string {
  return toISODate(new Date());
}

/** Склонение: 1 день, 2 дня, 5 дней */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дня`;
  return `${n} дней`;
}

/**
 * Отметка выплаты полученной — с фактической суммой.
 *
 * У агрегаторов сумма каждую неделю разная, поэтому считать только от настройки
 * нельзя: в остаток попало бы расчётное число вместо реального. Поле
 * предзаполняется расчётом, но правится свободно, и введённое становится
 * записанным внесением.
 */
function ReceiveDialog({
  title,
  calculated,
  commission,
  onClose,
  onConfirm,
}: {
  title: string;
  calculated: number;
  commission: number;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(String(calculated));
  const num = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(num) && num > 0;
  // Разность берём от расчётного к введённому, а не наоборот: положительное
  // значение должно означать «пришло больше ожидаемого». Обратный порядок дал
  // бы подпись «больше» в случае, когда пришло меньше.
  const diff = valid ? Math.round((num - calculated) * 100) / 100 : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Выплата получена</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConfirm(num);
          }}
        >
          <div className="form-group">
            <label className="form-label">Куда пришло</label>
            <div className="mv-title">{title}</div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="receive-amount">
              Сколько пришло на руки (₸)
            </label>
            <input
              id="receive-amount"
              type="number"
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="field-hint" style={{ marginTop: 6 }}>
              По настройке выходит {formatMoney(calculated)}
              {commission > 0 && ` (агрегатор удержит ${formatMoney(commission)})`}. Если
              пришло по-другому — поправьте здесь, запишется ровно то, что вы ввели.
            </div>
          </div>

          {valid && Math.abs(diff) >= 1 && (
            <div className="mv-diff">
              Отличается от расчётного на {formatMoney(Math.abs(diff))}
              {diff > 0 ? ' больше' : ' меньше'}
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valid}>
              <Check size={16} />
              Записать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface LoanForm {
  title: string;
  source: string;
  amount: string;
  dateTaken: string;
  dateDue: string;
  depositCategoryId: string;
  note: string;
}

const emptyLoanForm = (): LoanForm => ({
  title: '',
  source: '',
  amount: '',
  dateTaken: todayISO(),
  dateDue: todayISO(),
  depositCategoryId: '',
  note: '',
});

interface IncomeForm {
  title: string;
  categoryId: string;
  amount: string;
  commission: string;
  frequency: RecurringFrequency;
  nextDate: string;
}

const emptyIncomeForm = (): IncomeForm => ({
  title: '',
  categoryId: '',
  amount: '',
  // Пусто, а не «0»: в поле со значением первый же ввод дописывался бы
  // справа и давал «025» вместо «25». Пустое поле печатается как надо.
  commission: '',
  frequency: 'weekly',
  nextDate: todayISO(),
});

export interface LoansIncomeModalProps {
  loans: LoanItem[];
  income: RecurringIncomeItem[];
  depositCategories: DepositCategory[];
  expenseCategories: Category[];
  loanDebtTotal: number;
  incomeMonthlyTotal: number;
  onClose: () => void;
  onAddLoan: (payload: {
    title: string;
    source?: string;
    amount: number;
    dateTaken: string;
    dateDue: string;
    depositCategoryId?: number;
    note?: string;
  }) => Promise<void>;
  onRepayLoan: (payload: {
    id: number;
    amount: number;
    categoryId: number;
    date: string;
  }) => Promise<void>;
  onDeleteLoan: (id: number) => void;
  onAddIncome: (payload: {
    title: string;
    categoryId: number;
    amount: number;
    commissionPercent: number;
    frequency: RecurringFrequency;
    nextDate: string;
  }) => Promise<void>;
  onUpdateIncome: (
    id: number,
    payload: {
      title: string;
      categoryId: number;
      amount: number;
      commissionPercent: number;
      frequency: RecurringFrequency;
      nextDate: string;
    }
  ) => Promise<void>;
  onReceiveIncome: (id: number, actualAmount?: number) => void;
  onToggleIncome: (id: number) => void;
  onDeleteIncome: (id: number) => void;
}

type RepayDraft = { id: number; amount: string; categoryId: string; date: string } | null;

/**
 * Займы и регулярные внесения на одном экране.
 *
 * Два раздела выбраны вместе не случайно: оба отвечают на вопрос «откуда и
 * куда движутся деньги не из заработка» и оба требуют напоминания в срок,
 * которого программа до сих пор не умела. Разводить их по двум меню значило
 * бы заставлять пользователя искать, где что лежит.
 */
export function LoansIncomeModal({
  loans,
  income,
  depositCategories,
  expenseCategories,
  loanDebtTotal,
  incomeMonthlyTotal,
  onClose,
  onAddLoan,
  onRepayLoan,
  onDeleteLoan,
  onAddIncome,
  onUpdateIncome,
  onReceiveIncome,
  onToggleIncome,
  onDeleteIncome,
}: LoansIncomeModalProps) {
  const [tab, setTab] = useState<'loans' | 'income'>('loans');

  const [loanForm, setLoanForm] = useState<LoanForm>(emptyLoanForm);
  const [loanFormOpen, setLoanFormOpen] = useState(false);
  const [incomeForm, setIncomeForm] = useState<IncomeForm>(emptyIncomeForm);
  const [incomeFormOpen, setIncomeFormOpen] = useState(false);
  const [editingIncomeId, setEditingIncomeId] = useState<number | null>(null);
  const [repay, setRepay] = useState<RepayDraft>(null);
  const [error, setError] = useState('');
  /** Выплата, для которой спрашиваем фактически пришедшую сумму */
  const [receivingId, setReceivingId] = useState<number | null>(null);

  const receiving = receivingId !== null ? income.find((i) => i.id === receivingId) : undefined;

  const openLoans = loans.filter((l) => l.remaining > 0.001);
  const closedLoans = loans.filter((l) => l.remaining <= 0.001);
  const overdueCount = openLoans.filter((l) => l.is_overdue).length;

  // Первая трата для возврата: категория трат нужна обязательно, а выбирать
  // её каждый раз вручную tiresome — берём первую и даём сменить.
  const defaultExpenseCategoryId = expenseCategories[0]?.id ?? 0;

  const loanValid =
    loanForm.title.trim() !== '' &&
    Number.isFinite(Number(loanForm.amount.replace(',', '.'))) &&
    Number(loanForm.amount.replace(',', '.')) > 0 &&
    loanForm.dateTaken !== '' &&
    loanForm.dateDue !== '';

  const incomeAmount = Number(incomeForm.amount.replace(',', '.'));
  const incomeCommission = Number(incomeForm.commission.replace(',', '.')) || 0;
  const incomeValid =
    incomeForm.title.trim() !== '' &&
    incomeForm.categoryId !== '' &&
    Number.isFinite(incomeAmount) &&
    incomeAmount > 0 &&
    incomeCommission >= 0 &&
    incomeCommission < 100 &&
    incomeForm.nextDate !== '';

  const incomeNetPreview =
    Number.isFinite(incomeAmount) && incomeAmount > 0
      ? Math.round(incomeAmount * (1 - incomeCommission / 100) * 100) / 100
      : null;

  const submitLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanValid) return;
    setError('');
    try {
      await onAddLoan({
        title: loanForm.title.trim(),
        source: loanForm.source.trim() || undefined,
        amount: Number(loanForm.amount.replace(',', '.')),
        dateTaken: loanForm.dateTaken,
        dateDue: loanForm.dateDue,
        depositCategoryId:
          loanForm.depositCategoryId === ''
            ? undefined
            : Number(loanForm.depositCategoryId),
        note: loanForm.note.trim() || undefined,
      });
      setLoanForm(emptyLoanForm());
      setLoanFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить заём');
    }
  };

  const submitIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incomeValid) return;
    setError('');
    const payload = {
      title: incomeForm.title.trim(),
      categoryId: Number(incomeForm.categoryId),
      amount: incomeAmount,
      commissionPercent: incomeCommission,
      frequency: incomeForm.frequency,
      nextDate: incomeForm.nextDate,
    };
    try {
      if (editingIncomeId) await onUpdateIncome(editingIncomeId, payload);
      else await onAddIncome(payload);
      setIncomeForm(emptyIncomeForm());
      setIncomeFormOpen(false);
      setEditingIncomeId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить выплату');
    }
  };

  const submitRepay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repay) return;
    const amount = Number(repay.amount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0 || repay.categoryId === '') return;
    setError('');
    try {
      await onRepayLoan({
        id: repay.id,
        amount,
        categoryId: Number(repay.categoryId),
        date: repay.date,
      });
      setRepay(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось записать возврат');
    }
  };

  const startIncomeEdit = (item: RecurringIncomeItem) => {
    setEditingIncomeId(item.id);
    setIncomeForm({
      title: item.title,
      categoryId: String(item.category_id),
      amount: String(item.amount),
      // Доля в базе — в форме проценты, как их видит человек
      commission: String(Math.round(item.commission * 100)),
      frequency: item.frequency,
      nextDate: item.next_date,
    });
    setIncomeFormOpen(true);
    setError('');
  };

  const activeIncome = useMemo(() => income.filter((i) => i.is_active === 1), [income]);
  const inactiveIncome = useMemo(() => income.filter((i) => i.is_active !== 1), [income]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Займы и выплаты</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="li-tabs">
          <button
            className={`li-tab ${tab === 'loans' ? 'active' : ''}`}
            onClick={() => {
              setTab('loans');
              setError('');
            }}
          >
            <HandCoins size={15} />
            Займы
            {openLoans.length > 0 && <span className="li-tab-count">{openLoans.length}</span>}
          </button>
          <button
            className={`li-tab ${tab === 'income' ? 'active' : ''}`}
            onClick={() => {
              setTab('income');
              setError('');
            }}
          >
            <TrendingUp size={15} />
            Регулярные внесения
            {activeIncome.length > 0 && (
              <span className="li-tab-count">{activeIncome.length}</span>
            )}
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {/* ——— Займы ——— */}
        {tab === 'loans' && (
          <div className="li-pane">
            {loanFormOpen ? (
              <form className="li-form" onSubmit={submitLoan}>
                <div className="breakdown-title">Новый заём</div>

                <div className="form-row">
                  <div className="form-group li-field-wide">
                    <label className="form-label">Название</label>
                    <input
                      type="text"
                      value={loanForm.title}
                      placeholder="Кредит на закуп"
                      autoFocus
                      onChange={(e) => setLoanForm({ ...loanForm, title: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Кто дал</label>
                    <input
                      type="text"
                      value={loanForm.source}
                      placeholder="банк, человек…"
                      onChange={(e) => setLoanForm({ ...loanForm, source: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Сумма (₸)</label>
                    <input
                      type="number"
                      value={loanForm.amount}
                      placeholder="100000"
                      onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Взяли</label>
                    <input
                      type="date"
                      value={loanForm.dateTaken}
                      onChange={(e) => setLoanForm({ ...loanForm, dateTaken: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Вернуть до</label>
                    <input
                      type="date"
                      value={loanForm.dateDue}
                      onChange={(e) => setLoanForm({ ...loanForm, dateDue: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group li-field-wide">
                    <label className="form-label">Категория внесения</label>
                    <select
                      value={loanForm.depositCategoryId}
                      onChange={(e) =>
                        setLoanForm({
                          ...loanForm,
                          depositCategoryId:
                            e.target.value === '' ? '' : String(Number(e.target.value)),
                        })
                      }
                    >
                      <option value="">— не записывать приход —</option>
                      {depositCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field-hint li-form-hint">
                  Деньги займа не попадают в доходы, а возврат — в расходы: это те же
                  деньги, только чужие. Если выбрать категорию, программа сразу
                  запишет приход на {loanForm.dateTaken || 'дату получения'}.
                </div>

                <div className="recurring-form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setLoanFormOpen(false);
                      setLoanForm(emptyLoanForm());
                    }}
                  >
                    Отмена
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!loanValid}>
                    <Plus size={16} />
                    Добавить
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="recurring-add-trigger"
                onClick={() => setLoanFormOpen(true)}
              >
                <Plus size={16} />
                Новый заём
              </button>
            )}

            {loans.length === 0 ? (
              <div className="recurring-modal-empty">
                Займов нет. Если деньги на закуп придётся брать — заведите заём, и
                программа напомнит о возврате и не припишет чужие деньги к доходу.
              </div>
            ) : (
              <>
                <div className="li-summary">
                  Долг сейчас: <strong>{formatMoney(loanDebtTotal)}</strong>
                  {overdueCount > 0 && (
                    <span className="li-summary-warn">
                      <AlertTriangle size={13} />
                      просрочено: {overdueCount}
                    </span>
                  )}
                </div>

                <div className="recurring-list">
                  {[...openLoans, ...closedLoans].map((loan) => {
                    const settled = loan.remaining <= 0.001;
                    return (
                      <div
                        key={loan.id}
                        className={`recurring-row ${settled ? 'off' : ''}`}
                      >
                        <div className="recurring-row-main">
                          <div className="recurring-row-title">
                            {loan.title}
                            {settled && (
                              <span className="recurring-off-badge">погашен</span>
                            )}
                            {!settled && loan.is_overdue && (
                              <span className="li-badge-overdue">просрочен</span>
                            )}
                          </div>
                          <div className="recurring-row-meta">
                            {loan.source ? `${loan.source} · ` : ''}взято{' '}
                            {loan.date_taken} · вернуть до {loan.date_due}
                          </div>
                        </div>

                        <div className="recurring-row-amount">
                          {settled ? formatMoney(loan.taken) : formatMoney(loan.remaining)}
                          <div className="recurring-row-meta">
                            {settled
                              ? `возвращено ${formatMoney(loan.repaid)}`
                              : `из ${formatMoney(loan.taken)}`}
                          </div>
                        </div>

                        <div className="recurring-row-actions">
                          {!settled &&
                            (repay?.id === loan.id ? (
                              <form className="li-repay" onSubmit={submitRepay}>
                                <input
                                  type="number"
                                  className="li-repay-amount"
                                  value={repay.amount}
                                  placeholder={String(loan.remaining)}
                                  autoFocus
                                  onChange={(e) =>
                                    setRepay({ ...repay, amount: e.target.value })
                                  }
                                />
                                <select
                                  className="li-repay-cat"
                                  value={repay.categoryId}
                                  onChange={(e) =>
                                    setRepay({ ...repay, categoryId: e.target.value })
                                  }
                                >
                                  {expenseCategories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  className="li-repay-date"
                                  value={repay.date}
                                  onChange={(e) => setRepay({ ...repay, date: e.target.value })}
                                />
                                <button
                                  type="submit"
                                  className="action-btn"
                                  title="Записать возврат"
                                  aria-label="Записать возврат"
                                >
                                  <Check size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="action-btn"
                                  onClick={() => setRepay(null)}
                                  title="Отмена"
                                  aria-label="Отмена"
                                >
                                  <X size={15} />
                                </button>
                              </form>
                            ) : (
                              <button
                                className="btn btn-secondary li-repay-btn"
                                onClick={() =>
                                  setRepay({
                                    id: loan.id,
                                    amount: String(loan.remaining),
                                    categoryId: String(defaultExpenseCategoryId),
                                    date: todayISO(),
                                  })
                                }
                              >
                                Вернуть
                              </button>
                            ))}
                          <button
                            className="action-btn"
                            onClick={() => onDeleteLoan(loan.id)}
                            title="Удалить заём вместе с его записями"
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
        )}

        {/* ——— Регулярные внесения ——— */}
        {tab === 'income' && (
          <div className="li-pane">
            {incomeFormOpen ? (
              <form className="li-form" onSubmit={submitIncome}>
                <div className="breakdown-title">
                  {editingIncomeId ? 'Изменить выплату' : 'Новая выплата'}
                </div>

                <div className="form-row">
                  <div className="form-group li-field-wide">
                    <label className="form-label">Название</label>
                    <input
                      type="text"
                      value={incomeForm.title}
                      placeholder="Яндекс, Вольт…"
                      autoFocus
                      onChange={(e) => setIncomeForm({ ...incomeForm, title: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Категория внесения</label>
                    <select
                      value={incomeForm.categoryId}
                      onChange={(e) =>
                        setIncomeForm({
                          ...incomeForm,
                          categoryId: e.target.value === '' ? '' : String(Number(e.target.value)),
                        })
                      }
                    >
                      <option value="">— выбрать —</option>
                      {depositCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Сумма до удержания (₸)</label>
                    <input
                      type="number"
                      value={incomeForm.amount}
                      placeholder="50000"
                      onChange={(e) => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Процент агрегатора, %</label>
                    <input
                      type="number"
                      value={incomeForm.commission}
                      placeholder="25"
                      min="0"
                      max="99"
                      onChange={(e) =>
                        setIncomeForm({ ...incomeForm, commission: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Повтор</label>
                    <select
                      value={incomeForm.frequency}
                      onChange={(e) =>
                        setIncomeForm({
                          ...incomeForm,
                          frequency: e.target.value as RecurringFrequency,
                        })
                      }
                    >
                      {RECURRING_FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Первая выплата</label>
                    <input
                      type="date"
                      value={incomeForm.nextDate}
                      onChange={(e) => setIncomeForm({ ...incomeForm, nextDate: e.target.value })}
                    />
                  </div>
                </div>

                {incomeNetPreview !== null && incomeCommission > 0 && (
                  <div className="li-net-preview">
                    На руки придёт{' '}
                    <strong>{formatMoney(incomeNetPreview)}</strong>
                    <span className="li-net-cut">
                      агрегатор удержит {formatMoney(incomeAmount - incomeNetPreview)}
                    </span>
                  </div>
                )}

                <div className="recurring-form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setIncomeFormOpen(false);
                      setEditingIncomeId(null);
                      setIncomeForm(emptyIncomeForm());
                    }}
                  >
                    Отмена
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!incomeValid}>
                    {editingIncomeId ? <Check size={16} /> : <Plus size={16} />}
                    {editingIncomeId ? 'Сохранить' : 'Добавить'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="recurring-add-trigger"
                onClick={() => setIncomeFormOpen(true)}
              >
                <Plus size={16} />
                Новая выплата
              </button>
            )}

            {income.length === 0 ? (
              <div className="recurring-modal-empty">
                Регулярных внесений нет. Добавьте выплату агрегатора — программа
                посчитает сумму за вычетом его процента и напомнит о выплате.
              </div>
            ) : (
              <>
                {incomeMonthlyTotal > 0 && (
                  <div className="recurring-modal-total">
                    Постоянно приходит: <strong>{formatMoney(incomeMonthlyTotal)}</strong> в
                    месяц
                  </div>
                )}

                <div className="recurring-list">
                  {[...activeIncome, ...inactiveIncome].map((item) => {
                    const off = item.is_active !== 1;
                    const cut = Math.round(
                      (item.amount - item.net) * 100
                    ) / 100;
                    return (
                      <div key={item.id} className={`recurring-row ${off ? 'off' : ''}`}>
                        <div
                          className="recurring-row-icon"
                          style={{
                            background: `${item.category_color ?? '#888'}22`,
                            color: item.category_color ?? '#888',
                          }}
                        >
                          <TrendingUp size={15} />
                        </div>

                        <div className="recurring-row-main">
                          <div className="recurring-row-title">
                            {item.title}
                            {off && (
                              <span className="recurring-off-badge">выключено</span>
                            )}
                          </div>
                          <div className="recurring-row-meta">
                            {item.category_name} · {frequencyLabel(item.frequency)} · с{' '}
                            {item.next_date}
                            {item.commission > 0 && ` · процент ${Math.round(item.commission * 100)}%`}
                          </div>
                        </div>

                        <div className="recurring-row-amount">
                          {formatMoney(item.net)}
                          <div className="recurring-row-meta">
                            {item.commission > 0
                              ? `из ${formatMoney(item.amount)}, минус ${formatMoney(cut)}`
                              : formatMoney(item.amount)}
                          </div>
                        </div>

                        <div className="recurring-row-actions">
                          {!off && (
                            <button
                              className="btn btn-secondary li-repay-btn"
                              onClick={() => setReceivingId(item.id)}
                            >
                              Получено
                            </button>
                          )}
                          <button
                            className="action-btn"
                            onClick={() => onToggleIncome(item.id)}
                            title={off ? 'Включить' : 'Выключить'}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            className="action-btn"
                            onClick={() => startIncomeEdit(item)}
                            title="Изменить"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="action-btn"
                            onClick={() => onDeleteIncome(item.id)}
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
        )}

        <div className="modal-footer">
          <span
            style={{
              marginRight: 'auto',
              fontSize: 12,
              color: 'var(--text-muted)',
              alignSelf: 'center',
            }}
          >
            {overdueCount > 0 && tab === 'loans'
              ? `Просроченных займов: ${pluralDays(overdueCount)}`
              : `Траты Сани v${__APP_VERSION__}`}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>

      {/* Поверх окна: сколько реально пришло. Сумма у агрегаторов гуляет,
          поэтому доверять только расчёту по проценту нельзя. */}
      {receiving && (
        <ReceiveDialog
          title={receiving.title}
          calculated={receiving.net}
          commission={Math.round((receiving.amount - receiving.net) * 100) / 100}
          onClose={() => setReceivingId(null)}
          onConfirm={(actual) => {
            setReceivingId(null);
            onReceiveIncome(receiving.id, actual);
          }}
        />
      )}
    </div>
  );
}