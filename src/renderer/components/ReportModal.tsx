import { useEffect, useState, Fragment } from 'react';
import ReportCharts from './ReportCharts';
import {
  X,
  FileDown,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
  Banknote,
  Sheet,
  HandCoins,
} from 'lucide-react';
import type { Period, Report } from '../types';
import { formatMoney, getPeriodLabel } from '../lib/format';
import { depositColorMap, expenseColorMap } from '../lib/reportColors';

interface ReportModalProps {
  period: Period;
  onClose: () => void;
  onExport: (report: Report, period: Period) => void;
  onExportXlsx: (report: Report, period: Period) => void;
}

type ReportTab = 'all' | 'expenses' | 'deposits';

const TABS: { id: ReportTab; label: string }[] = [
  { id: 'all', label: 'Общий отчёт' },
  { id: 'expenses', label: 'Траты' },
  { id: 'deposits', label: 'Внесения' },
];

export default function ReportModal({ period, onClose, onExport, onExportXlsx }: ReportModalProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [tab, setTab] = useState<ReportTab>('all');

  // Точки в таблицах берут те же цвета, что и сектора диаграмм
  const expenseColors = report ? expenseColorMap(report) : {};
  const depositColors = report ? depositColorMap(report) : {};
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI
      .getReport(period.startDate, period.endDate)
      .then((data: Report) => {
        if (!cancelled) {
          setReport(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        console.error('Ошибка загрузки отчёта:', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period.startDate, period.endDate]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        {/* Шапка и вкладки липкие: при прокрутке длинного отчёта заголовок
            и переключатель вкладок остаются на виду */}
        <div className="report-head">
          <div className="modal-header">
            <h2 className="modal-title">
              Отчёт: {getPeriodLabel(period)}
            </h2>
            <button className="modal-close" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>

          <div className="report-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`report-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {report && t.id === 'expenses' && report.expenses.length > 0 && (
                  <span className="report-tab-count">{report.expenses.length}</span>
                )}
                {report && t.id === 'deposits' && report.deposits.length > 0 && (
                  <span className="report-tab-count">{report.deposits.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <p>Загрузка отчёта...</p>
          </div>
        ) : report ? (
          <>
            {tab === 'all' && (
            <div className="report-summary">
              <div className="summary-card">
                <div className="summary-label">
                  <Wallet size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Начало (база)
                </div>
                <div className="summary-value neutral">{formatMoney(report.startBalance)}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  <Banknote size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Внесения
                </div>
                <div className="summary-value positive">
                  {report.totalDeposits > 0 ? '+' : ''}
                  {formatMoney(report.totalDeposits)}
                </div>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  <TrendingDown size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Траты
                </div>
                <div className="summary-value negative">
                  {report.totalExpenses > 0 ? '-' : ''}
                  {formatMoney(report.totalExpenses)}
                </div>
              </div>
              {/* Кредиты — отдельной графой, а не строкой под карточками.
                  Ни доход, ни расход, но остаток двигает, поэтому без этого
                  слагаемого уравнение «начало + внесения − траты = на выходе»
                  не сходится на сумму взятого и возвращённого. */}
              <div className="summary-card">
                <div className="summary-label">
                  <HandCoins size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Кредиты
                </div>
                <div
                  className={`summary-value ${
                    report.loanNet === 0
                      ? 'neutral'
                      : report.loanNet > 0
                        ? 'positive'
                        : 'negative'
                  }`}
                >
                  {report.loanNet !== 0 ? (report.loanNet > 0 ? '+' : '-') : ''}
                  {formatMoney(Math.abs(report.loanNet))}
                </div>
                <div className="summary-hint">
                  взято {formatMoney(report.loanTaken)} · возврат {formatMoney(report.loanRepaid)}
                </div>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  <Wallet size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  На выходе
                </div>
                <div
                  className={`summary-value ${
                    report.endBalance >= 0 ? 'positive' : 'negative'
                  }`}
                >
                  {formatMoney(report.endBalance)}
                </div>
              </div>
            </div>
            )}

            {/* Разбивка кредитов. В карточках выше это одно число «взято минус
                возвращено», здесь видно, из чего оно сложилось. */}
            {tab === 'all' && (report.loanTaken > 0 || report.loanRepaid > 0) && (
              <div className="loan-report-row">
                <HandCoins size={14} />
                <span>
                  Кредиты: взято <strong>{formatMoney(report.loanTaken)}</strong>, возвращено{' '}
                  <strong>{formatMoney(report.loanRepaid)}</strong>
                </span>
                {report.openLoanDebt > 0 && (
                  <span className="loan-report-debt">
                    долг сейчас {formatMoney(report.openLoanDebt)}
                  </span>
                )}
              </div>
            )}

            {/* Удержание агрегаторов — не трата, а вычет из дохода, поэтому
                в «Траты» его нет и показывается отдельной строкой. */}
            {tab === 'all' && report.withheldByAggregators > 0 && (
              <div className="loan-report-row">
                <TrendingUp size={14} />
                <span>
                  Агрегаторы удержали{' '}
                  <strong>{formatMoney(report.withheldByAggregators)}</strong>
                </span>
                <span className="loan-report-debt">из внесений, не трата</span>
              </div>
            )}

            {/* Отдельная сводка по вкладкам «Траты» и «Внесения» */}
            {tab === 'expenses' && (
              <div className="report-summary">
                <div className="summary-card">
                  <div className="summary-label">
                    <TrendingDown size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Траты за период
                  </div>
                  <div className="summary-value negative">
                    {formatMoney(report.totalExpenses)}
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Операций</div>
                  <div className="summary-value neutral">{report.expenses.length}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Категорий</div>
                  <div className="summary-value neutral">
                    {Object.keys(report.byCategory).length}
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Средняя трата</div>
                  <div className="summary-value neutral">
                    {formatMoney(
                      report.expenses.length
                        ? report.totalExpenses / report.expenses.length
                        : 0
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'deposits' && (
              <div className="report-summary">
                <div className="summary-card">
                  <div className="summary-label">
                    <Banknote size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Внесено за период
                  </div>
                  <div className="summary-value positive">
                    +{formatMoney(report.totalDeposits)}
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Операций</div>
                  <div className="summary-value neutral">{report.deposits.length}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Категорий</div>
                  <div className="summary-value neutral">
                    {Object.keys(report.byDepositCategory || {}).length}
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Среднее</div>
                  <div className="summary-value neutral">
                    {formatMoney(
                      report.deposits.length ? report.totalDeposits / report.deposits.length : 0
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'all' && (
            <>
            {/* Движение денег: начало → внесения → траты → расчётный выход */}
            <div className="deposit-summary-card" style={{ marginBottom: 20 }}>
              <div className="summary-label" style={{ marginBottom: 4 }}>
                Движение денег за период
              </div>
              <div className="ledger-row">
                <span className="ledger-label">
                  <Wallet size={14} /> Начало (база)
                </span>
                <span className="ledger-value">{formatMoney(report.startBalance)}</span>
              </div>
              <div className="ledger-row">
                <span className="ledger-label">
                  <Banknote size={14} /> Внесения
                </span>
                <span
                  className="ledger-value"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  +{formatMoney(report.totalDeposits)}
                </span>
              </div>
              <div className="ledger-row">
                <span className="ledger-label">
                  <TrendingDown size={14} /> Траты
                </span>
                <span
                  className="ledger-value"
                  style={{
                    color: report.totalExpenses > 0 ? 'var(--accent-danger)' : undefined,
                  }}
                >
                  {report.totalExpenses > 0 ? '-' : ''}
                  {formatMoney(report.totalExpenses)}
                </span>
              </div>
              {/* Та же строка, что и карточка сверху. Без неё этот список
                  расходится с итогом всякий раз, когда кредит взят и не
                  возвращён: деньги займа двигают остаток, оставаясь вне
                  «Внесений» и «Трат». Нулевой кредит не печатаем — иначе
                  уравнение раздувается лишним нулём. */}
              {(report.loanTaken > 0 || report.loanRepaid > 0) && (
                <div className="ledger-row">
                  <span className="ledger-label">
                    <HandCoins size={14} /> Кредиты
                  </span>
                  <span className="ledger-value" style={{ color: 'var(--accent-purple)' }}>
                    {report.loanNet > 0 ? '+' : report.loanNet < 0 ? '-' : ''}
                    {formatMoney(Math.abs(report.loanNet))}
                  </span>
                </div>
              )}
              <div className="ledger-row">
                <span
                  className="ledger-label"
                  style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                >
                  <Wallet size={14} /> На выходе
                </span>
                <span
                  className="ledger-value"
                  style={{
                    fontSize: 17,
                    color:
                      report.endBalance >= 0
                        ? 'var(--accent-primary)'
                        : 'var(--accent-danger)',
                  }}
                >
                  {formatMoney(report.endBalance)}
                </span>
              </div>
            </div>

            {report.baseCheckpoint.date && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginTop: -12,
                  marginBottom: 20,
                }}
              >
                Расчёт отталкивается от отметки «Указать остаток»:{' '}
                {formatMoney(report.baseCheckpoint.amount)} от{' '}
                {new Date(report.baseCheckpoint.date).toLocaleDateString('ru-RU')}
                {new Date(report.baseCheckpoint.date) >= new Date(report.period.startDate) &&
                  new Date(report.baseCheckpoint.date) <= new Date(report.period.endDate) &&
                  ' — она внутри периода, поэтому операции до неё не дублируются'}
              </div>
            )}
            </>
            )}

            {(() => {
              // Пустая вкладка — это «нет трат» или «нет внесений»,
              // а не «нет операций вообще»
              const isEmpty =
                tab === 'expenses'
                  ? report.expenses.length === 0
                  : tab === 'deposits'
                  ? report.deposits.length === 0
                  : report.expenses.length === 0 && report.deposits.length === 0;
              const emptyText =
                tab === 'expenses'
                  ? 'Нет трат за выбранный период'
                  : tab === 'deposits'
                  ? 'Нет внесений за выбранный период'
                  : 'Нет операций за выбранный период';

              if (isEmpty) {
                return (
                  <div className="empty-state">
                    <Receipt size={48} className="empty-state-icon" />
                    <div className="empty-state-title">{emptyText}</div>
                  </div>
                );
              }
              return null;
            })()}

            {!((tab === 'expenses' && report.expenses.length === 0) ||
              (tab === 'deposits' && report.deposits.length === 0) ||
              (tab === 'all' && report.expenses.length === 0 && report.deposits.length === 0)) && (
              <>
                <ReportCharts report={report} mode={tab} />

            {(tab === 'all' || tab === 'expenses') && report.expenses.length > 0 && (
                  <div className="report-breakdown">
                    <div className="breakdown-title">Расходы по категориям</div>
                    <table className="breakdown-table">
                      <thead>
                        <tr>
                          <th>Категория / Подкатегория / Статья</th>
                          <th style={{ textAlign: 'right', width: 160 }}>Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(report.byCategory).map(([catName, data]) => (
                          <Fragment key={catName}>
                            <tr>
                              <td className="breakdown-category">
                                <span
                                  className="chart-legend-dot"
                                  style={{
                                    background: expenseColors[catName],
                                    display: 'inline-block',
                                    marginRight: 8,
                                  }}
                                />
                                {catName}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                {formatMoney(data.total)}
                              </td>
                            </tr>
                            {Object.entries(data.subcategories).map(([subName, sub]) => (
                              <Fragment key={`${catName}-${subName}`}>
                                <tr>
                                  <td className="breakdown-subcategory">└ {subName}</td>
                                  <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                                    {formatMoney(sub.total)}
                                  </td>
                                </tr>
                                {Object.entries(sub.items).map(([itemName, itemTotal]) => (
                                  <tr key={`${catName}-${subName}-${itemName}`}>
                                    <td className="breakdown-item">└─ {itemName}</td>
                                    <td
                                      style={{
                                        textAlign: 'right',
                                        color: 'var(--text-muted)',
                                      }}
                                    >
                                      {formatMoney(itemTotal)}
                                    </td>
                                  </tr>
                                ))}
                              </Fragment>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === 'deposits' && report.deposits.length > 0 && (
                  <div className="report-breakdown">
                    <div className="breakdown-title">Внесения за период</div>
                <table className="breakdown-table">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Дата</th>
                      <th>Категория</th>
                      <th style={{ textAlign: 'right', width: 160 }}>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.deposits.map((d) => (
                      <tr key={d.id}>
                        <td className="date-cell">
                          {new Date(d.date).toLocaleDateString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                          })}
                        </td>
                        <td>{d.category_name || 'Без категории'}</td>
                        <td
                          style={{
                            textAlign: 'right',
                            color: 'var(--accent-primary)',
                            fontWeight: 600,
                          }}
                        >
                          +{formatMoney(d.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Итог по категориям внесений — чтобы было видно, откуда
                    пришли деньги, а не только сумму по дням */}
                {Object.keys(report.byDepositCategory || {}).length > 0 && (
                  <div className="deposit-totals">
                    {Object.entries(report.byDepositCategory)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([name, data]) => (
                        <div key={name} className="deposit-total-row">
                          <span
                            className="chart-legend-dot"
                            style={{ background: depositColors[name] }}
                          />
                          <span className="deposit-total-name">{name}</span>
                          <span className="deposit-total-sum">
                            {formatMoney(data.total)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
                )}
              </>
            )}

            {/* Дублируем общие внесения под всеми данными: та же сумма, что в
                карточке сверху, но с раскладкой по категориям и количеством */}
            {(tab === 'all' || tab === 'deposits') && report.deposits.length > 0 && (
              <div className="report-breakdown">
                <div className="breakdown-title">Итоги внесений</div>
                <div className="summary-grid">
                  <div className="summary-cell">
                    <span className="summary-label">Всего внесено</span>
                    <span className="summary-value income">
                      {formatMoney(report.totalDeposits)}
                    </span>
                  </div>
                  <div className="summary-cell">
                    <span className="summary-label">Операций</span>
                    <span className="summary-value">{report.deposits.length}</span>
                  </div>
                  <div className="summary-cell">
                    <span className="summary-label">Категорий</span>
                    <span className="summary-value">
                      {Object.keys(report.byDepositCategory || {}).length}
                    </span>
                  </div>
                  <div className="summary-cell">
                    <span className="summary-label">Среднее</span>
                    <span className="summary-value">
                      {formatMoney(report.totalDeposits / report.deposits.length)}
                    </span>
                  </div>
                </div>

                <table className="breakdown-table summary-table">
                  <thead>
                    <tr>
                      <th>Категория</th>
                      <th style={{ textAlign: 'right' }}>Сумма</th>
                      <th style={{ textAlign: 'right' }}>Доля</th>
                      <th style={{ textAlign: 'right' }}>Операций</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.byDepositCategory)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([name, data]) => {
                        const count = report.deposits.filter(
                          (d) => (d.category_name || 'Без категории') === name
                        ).length;
                        const share =
                          report.totalDeposits > 0
                            ? ((data.total / report.totalDeposits) * 100).toFixed(1)
                            : '0.0';
                        return (
                          <tr key={name}>
                            <td>
                              <span
                                className="chart-legend-dot"
                                style={{
                                  background: depositColors[name],
                                  display: 'inline-block',
                                  marginRight: 8,
                                }}
                              />
                              {name}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {formatMoney(data.total)}
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                              {share}%
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                              {count}
                            </td>
                          </tr>
                        );
                      })}
                    <tr className="summary-total-row">
                      <td>
                        <strong>Итого</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{formatMoney(report.totalDeposits)}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>100%</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{report.deposits.length}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onClose}>
                Закрыть
              </button>
              <button className="btn btn-secondary" onClick={() => onExportXlsx(report, period)}>
                <Sheet size={18} />
                Экспорт в Excel
              </button>
              <button className="btn btn-primary" onClick={() => onExport(report, period)}>
                <FileDown size={18} />
                Экспорт в CSV
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>Не удалось загрузить отчёт</p>
          </div>
        )}
      </div>
    </div>
  );
}