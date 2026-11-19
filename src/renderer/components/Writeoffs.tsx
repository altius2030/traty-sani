import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Pencil, MinusCircle } from 'lucide-react';
import type { AccountBalance, WriteoffItem } from '../types';
import { formatMoney, toISODate } from '../lib/format';

export interface WriteoffModalProps {
  accounts: AccountBalance[];
  writeoffs: WriteoffItem[];
  /** Счёт, выбранный в боковой панели, — подставляется в форму */
  defaultAccountId: number | null;
  /** Рабочая дата из тулбара */
  workingDate: string;
  onClose: () => void;
  onAdd: (payload: {
    accountId: number;
    amount: number;
    date: string;
    note?: string;
  }) => Promise<void>;
  onUpdate: (payload: {
    id: number;
    accountId: number;
    amount: number;
    date: string;
    note?: string;
  }) => Promise<void>;
  onDelete: (id: number) => void;
}

/**
 * Списания со счетов.
 *
 * Деньги уменьшают остаток выбранного счёта, но не являются тратой: в отчёте
 * «Траты» их нет, в категориях их тоже нет. Отсюда же их и удаляют.
 *
 * Отдельное окно, как у переводов: списание — это операция со счётом, а не
 * расход. Держать его в списке трат значило бы вернуть ту самую проблему,
 * из-за которой он и понадобился.
 */
export function WriteoffModal({
  accounts,
  writeoffs,
  defaultAccountId,
  workingDate,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
}: WriteoffModalProps) {
  const fallbackId = accounts.find((a) => a.is_default === 1)?.id ?? accounts[0]?.id ?? 0;
  const [accountId, setAccountId] = useState<number>(defaultAccountId ?? fallbackId);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(workingDate || toISODate(new Date()));
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  // Если выбранный счёт удалили, возвращаемся к рабочему, иначе форма
  // отправила бы списание в никуда.
  useEffect(() => {
    if (!accounts.some((a) => a.id === accountId)) {
      setAccountId(accounts.find((a) => a.is_default === 1)?.id ?? accounts[0]?.id ?? 0);
    }
  }, [accounts, accountId]);

  const amountNum = Number(amount.replace(',', '.'));
  const valid = accountId > 0 && amountNum > 0 && date !== '';

  const account = accounts.find((a) => a.id === accountId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError('');
    try {
      if (editingId !== null) {
        await onUpdate({ id: editingId, accountId, amount: amountNum, date, note: note.trim() || undefined });
      } else {
        await onAdd({ accountId, amount: amountNum, date, note: note.trim() || undefined });
      }
      setAmount('');
      setNote('');
      setEditingId(null);
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить списание');
    }
  };

  const startEdit = (w: WriteoffItem) => {
    setEditingId(w.id);
    setAccountId(w.account_id);
    setAmount(String(w.amount));
    setDate(w.date);
    setNote(w.note ?? '');
    setFormOpen(true);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Списания со счетов</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="field-hint" style={{ marginBottom: 12 }}>
          Деньги ушли со счёта, но это <strong>не трата</strong>: в отчёте «Траты» и в
          категориях их нет. Подходит, когда забрал деньги на личное, передал без
          возврата или потерял. Остаток счёта уменьшается.
        </div>

        {accounts.length === 0 ? (
          <div className="recurring-modal-empty">
            Нужен хотя бы один счёт. Добавьте его в боковой панели, в разделе
            «Счета».
          </div>
        ) : (
          <>
            {formOpen ? (
              <form className="li-form" onSubmit={submit}>
                <div className="breakdown-title">
                  {editingId !== null ? 'Изменить списание' : 'Новое списание'}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Счёт</label>
                    <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({formatMoney(a.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Сумма (₸)</label>
                    <input
                      type="number"
                      value={amount}
                      placeholder="20000"
                      autoFocus
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Дата</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Комментарий</label>
                    <input
                      type="text"
                      value={note}
                      placeholder="необязательно"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                </div>

                {valid && account && (
                  <div className="li-net-preview">
                    <span>
                      {account.name}: <strong>{formatMoney(account.balance - amountNum)}</strong>
                    </span>
                    <span className="li-net-cut">в траты не попадает</span>
                  </div>
                )}

                {error && <div className="form-error">{error}</div>}

                <div className="recurring-form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setFormOpen(false);
                      setEditingId(null);
                      setAmount('');
                      setNote('');
                    }}
                  >
                    Отмена
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!valid}>
                    <Plus size={16} />
                    {editingId !== null ? 'Сохранить' : 'Списать'}
                  </button>
                </div>
              </form>
            ) : (
              <button className="recurring-add-trigger" onClick={() => setFormOpen(true)}>
                <MinusCircle size={16} />
                Новое списание
              </button>
            )}

            {writeoffs.length === 0 ? (
              <div className="recurring-modal-empty">
                Списаний пока нет. Если деньги ушли со счёта, но это не трата, —
                здесь и появится запись, которая не испортит ни расходы, ни
                доходы.
              </div>
            ) : (
              <div className="recurring-list">
                {writeoffs.map((w) => (
                  <div key={w.id} className="recurring-row">
                    <div
                      className="recurring-row-icon"
                      style={{
                        background: `${w.account_color ?? '#888'}22`,
                        color: w.account_color ?? '#888',
                      }}
                    >
                      <MinusCircle size={15} />
                    </div>
                    <div className="recurring-row-main">
                      <div className="recurring-row-title">{w.note || 'Списание'}</div>
                      <div className="recurring-row-meta">
                        {w.account_name} · {w.date}
                      </div>
                    </div>
                    <div className="recurring-row-amount">−{formatMoney(w.amount)}</div>
                    <div className="recurring-row-actions">
                      <button
                        className="action-btn"
                        onClick={() => startEdit(w)}
                        title="Изменить списание"
                        aria-label="Изменить списание"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="action-btn"
                        onClick={() => onDelete(w.id)}
                        title="Удалить списание"
                        aria-label="Удалить списание"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
