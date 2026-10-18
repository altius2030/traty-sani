import { useState } from 'react';
import {
  X,
  ArrowLeftRight,
  HandCoins,
  TrendingUp,
  TrendingDown,
  Trash2,
  Info,
} from 'lucide-react';
import type { MoneyMovement } from '../types';
import { formatMoney } from '../lib/format';

export interface MovementsModalProps {
  data: {
    movements: MoneyMovement[];
    withheld: number;
    loanDebt: number;
    loanTaken: number;
    loanRepaid: number;
  } | null;
  onClose: () => void;
  onDeleteTransfer: (id: number) => void;
}

const KIND_META: Record<
  MoneyMovement['kind'],
  { label: string; icon: typeof ArrowLeftRight; cls: string }
> = {
  transfer: { label: 'Перевод', icon: ArrowLeftRight, cls: 'mv-transfer' },
  payout: { label: 'Агрегатор', icon: TrendingUp, cls: 'mv-payout' },
  loan_in: { label: 'Кредит получен', icon: HandCoins, cls: 'mv-loan' },
  loan_repay: { label: 'Кредит возвращён', icon: TrendingDown, cls: 'mv-repay' },
};

/** Вкладки группируют виды операций, а не совпадают с ними один в один */
type TabId = 'all' | 'transfer' | 'payout' | 'loan';

const TAB_KINDS: Record<Exclude<TabId, 'all'>, MoneyMovement['kind'][]> = {
  transfer: ['transfer'],
  payout: ['payout'],
  // Получение и возврат кредита — одна вкладка: это две стороны одного долга,
  // и разносить их по разным вкладкам значило бы прятать возврат от того,
  // кто смотрит вкладку «Кредиты».
  loan: ['loan_in', 'loan_repay'],
};

/**
 * Движение денежных средств.
 *
 * Здесь собрано всё, что двигает деньги, но не меняет состояние: переводы
 * между своими счетами, выплаты агрегаторов и займы. По отдельности эти три
 * истории живут в своих окнах, но в отчёте и в остатке они ни одна не является
 * ни доходом, ни расходом — и здесь это видно сразу, строкой сверху.
 *
 * Собственные записи удаляются только у переводов: агрегаторские выплаты и
 * займы созданы ради истории, и стирать их отсюда значило бы оставлять дыру в
 * учёте. Их правят в своих окнах.
 */
export function MovementsModal({ data, onClose, onDeleteTransfer }: MovementsModalProps) {
  const [tab, setTab] = useState<TabId>('all');

  const movements = data?.movements ?? [];
  const shown = tab === 'all' ? movements : movements.filter((m) => TAB_KINDS[tab].includes(m.kind));

  const counts = {
    transfer: movements.filter((m) => m.kind === 'transfer').length,
    payout: movements.filter((m) => m.kind === 'payout').length,
    loan: movements.filter((m) => TAB_KINDS.loan.includes(m.kind)).length,
  };

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'all', label: 'Всё', count: movements.length },
    { id: 'transfer', label: 'Переводы', count: counts.transfer },
    { id: 'payout', label: 'Агрегаторы', count: counts.payout },
    { id: 'loan', label: 'Кредиты', count: counts.loan },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Движение денежных средств</h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        {/* Главная мысль экрана. Формулировка про остаток обязательна:
            «не входит в траты» — это про отчёт, а не про то, что деньги
            не приходят и не уходят. Заём остаток меняет. */}
        <div className="mv-note">
          <Info size={14} />
          <span>
            Здесь собрано то, что не попадает ни в «Внесения», ни в «Траты».
            Переводы и выплаты агрегаторов общий остаток не меняют: это ваши же
            деньги. А вот кредит меняет — деньги пришли, но они чужие, и пока не
            возвращены, висит долг.
          </span>
        </div>

        {data && (data.withheld > 0 || data.loanDebt > 0 || data.loanTaken > 0) && (
          <div className="mv-summary">
            {data.withheld > 0 && (
              <div className="mv-summary-card">
                <div className="mv-summary-label">Удержано агрегаторами</div>
                <div className="mv-summary-value warn">{formatMoney(data.withheld)}</div>
              </div>
            )}
            <div className="mv-summary-card">
              <div className="mv-summary-label">Кредитов взято</div>
              <div className="mv-summary-value">{formatMoney(data.loanTaken)}</div>
            </div>
            <div className="mv-summary-card">
              <div className="mv-summary-label">Возвращено</div>
              <div className="mv-summary-value">{formatMoney(data.loanRepaid)}</div>
            </div>
            <div className="mv-summary-card">
              <div className="mv-summary-label">Долг сейчас</div>
              <div
                className={`mv-summary-value ${
                  data.loanDebt > 0 ? 'warn' : 'ok'
                }`}
              >
                {formatMoney(data.loanDebt)}
              </div>
            </div>
          </div>
        )}

        <div className="li-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`li-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count > 0 && <span className="li-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="recurring-modal-empty">
            {movements.length === 0
              ? 'В этом периоде таких операций не было. Переводы между счетами, выплаты агрегаторов и кредиты собираются здесь.'
              : 'В этой группе пусто.'}
          </div>
        ) : (
          <div className="mv-list">
            {shown.map((m) => {
              const meta = KIND_META[m.kind];
              const I = meta.icon;
              return (
                <div key={m.key} className="mv-row">
                  <div className={`mv-icon ${meta.cls}`}>
                    <I size={15} />
                  </div>
                  <div className="mv-main">
                    <div className="mv-title">{m.title}</div>
                    <div className="mv-meta">
                      <span className="mv-kind">{meta.label}</span> · {m.detail}
                      {m.extra ? ` · ${m.extra}` : ''}
                    </div>
                  </div>
                  <div className="mv-amount">
                    {formatMoney(m.amount)}
                    {/* Влияние на остаток у всех видов разное: у перевода и
                        выплаты — ноль, у кредита — сама сумма. Подписываем
                        явно, иначе «не входит в траты» читается как
                        «остаток не меняется», а это неправда для кредита. */}
                    <div className={`mv-effect ${m.effect === 0 ? 'zero' : 'shift'}`}>
                      {m.effect === 0
                        ? 'на остаток: 0'
                        : `на остаток: ${m.effect > 0 ? '+' : '−'}${formatMoney(
                            Math.abs(m.effect)
                          )}`}
                    </div>
                  </div>
                  {m.canDelete && (
                    <button
                      className="action-btn"
                      onClick={() => onDeleteTransfer(Number(m.key.slice(1)))}
                      title="Удалить перевод"
                      aria-label="Удалить перевод"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
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