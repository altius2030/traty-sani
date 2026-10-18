import { useEffect, useState } from 'react';
import { X, ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import type { AccountBalance, TransferItem } from '../types';
import { formatMoney, toISODate } from '../lib/format';

export interface TransferModalProps {
  accounts: AccountBalance[];
  transfers: TransferItem[];
  onClose: () => void;
  onAdd: (payload: {
    fromAccountId: number;
    toAccountId: number;
    amount: number;
    date: string;
    note?: string;
  }) => Promise<void>;
  onDelete: (id: number) => void;
}

/**
 * Переводы между своими счетами.
 *
 * Отдельное окно, а не ещё одна вкладка в «Займах и выплатах»: перевод — это
 * движение внутри своих денег, а там живут операции с внешним миром. Смешивать
 * их в одном списке значило бы каждый раз разбираться, что есть что.
 */
export function TransferModal({
  accounts,
  transfers,
  onClose,
  onAdd,
  onDelete,
}: TransferModalProps) {
  const defaultId = accounts.find((a) => a.is_default === 1)?.id ?? accounts[0]?.id ?? 0;
  const [fromId, setFromId] = useState<number>(defaultId);
  const [toId, setToId] = useState<number>(accounts.find((a) => a.id !== defaultId)?.id ?? 0);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  // Если выбранные счёта куда-то исчезли (счёт удалили), возвращаемся к
  // рабочей паре, иначе форма отправила бы перевод в никуда.
  useEffect(() => {
    const ids = accounts.map((a) => a.id);
    if (!ids.includes(fromId)) setFromId(ids[0] ?? 0);
    if (!ids.includes(toId) || toId === fromId) {
      setToId(ids.find((id) => id !== fromId) ?? 0);
    }
  }, [accounts, fromId, toId]);

  const amountNum = Number(amount.replace(',', '.'));
  const valid = fromId > 0 && toId > 0 && fromId !== toId && amountNum > 0 && date !== '';

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError('');
    try {
      await onAdd({
        fromAccountId: fromId,
        toAccountId: toId,
        amount: amountNum,
        date,
        note: note.trim() || undefined,
      });
      setAmount('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить перевод');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Переводы между счетами</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="field-hint" style={{ marginBottom: 12 }}>
          Свои деньги, переложенные из одного места в другое. На общий остаток не
          влияет: из одного счёта уходит, в другой приходит. В траты и внесения
          не попадает, поэтому снятие наличных не выглядит расходом.
        </div>

        {accounts.length < 2 ? (
          <div className="recurring-modal-empty">
            Нужно минимум два счёта. Добавьте их в боковой панели, в разделе
            «Счета».
          </div>
        ) : (
          <>
            {formOpen ? (
              <form className="li-form" onSubmit={submit}>
                <div className="breakdown-title">Новый перевод</div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Откуда</label>
                    <select value={fromId} onChange={(e) => setFromId(Number(e.target.value))}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({formatMoney(a.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Куда</label>
                    <select value={toId} onChange={(e) => setToId(Number(e.target.value))}>
                      {accounts
                        .filter((a) => a.id !== fromId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({formatMoney(a.balance)})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
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

                {valid && from && to && (
                  <div className="li-net-preview">
                    <span>
                      {from.name}: <strong>{formatMoney(from.balance - amountNum)}</strong>
                    </span>
                    <span>
                      {to.name}: <strong>{formatMoney(to.balance + amountNum)}</strong>
                    </span>
                    <span className="li-net-cut">общий остаток не меняется</span>
                  </div>
                )}

                {error && <div className="form-error">{error}</div>}

                <div className="recurring-form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>
                    Отмена
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!valid}>
                    <Plus size={16} />
                    Перевести
                  </button>
                </div>
              </form>
            ) : (
              <button className="recurring-add-trigger" onClick={() => setFormOpen(true)}>
                <ArrowLeftRight size={16} />
                Новый перевод
              </button>
            )}

            {transfers.length === 0 ? (
              <div className="recurring-modal-empty">
                Переводов пока нет. Снимите наличные с карты — и здесь появится
                запись, которая не испортит ни доходы, ни расходы.
              </div>
            ) : (
              <div className="recurring-list">
                {transfers.map((t) => (
                  <div key={t.id} className="recurring-row">
                    <div
                      className="recurring-row-icon"
                      style={{ background: `${t.from_color ?? '#888'}22`, color: t.from_color ?? '#888' }}
                    >
                      <ArrowLeftRight size={15} />
                    </div>
                    <div className="recurring-row-main">
                      <div className="recurring-row-title">{t.note || 'Перевод'}</div>
                      <div className="recurring-row-meta">
                        {t.from_name} → {t.to_name} · {t.date}
                      </div>
                    </div>
                    <div className="recurring-row-amount">{formatMoney(t.amount)}</div>
                    <div className="recurring-row-actions">
                      <button
                        className="action-btn"
                        onClick={() => onDelete(t.id)}
                        title="Удалить перевод"
                        aria-label="Удалить перевод"
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