import { useEffect, useState, Fragment } from 'react';
import ReportCharts from './ReportCharts';
import { X, FileDown, TrendingDown, Wallet, Receipt, Banknote } from 'lucide-react';
import type { Period, Report } from '../types';
import { formatMoney, getPeriodLabel } from '../lib/format';

interface ReportModalProps {
  period: Period;
  onClose: () => void;
  onExport: (report: Report, period: Period) => void;
}

export default function ReportModal({ period, onClose, onExport }: ReportModalProps) {
  const [report, setReport] = useState<Report | null>(null);
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
        <div className="modal-header">
          <h2 className="modal-title">
            Отчёт: {getPeriodLabel(period)}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="empty-state">
            <p>Загрузка отчёта...</p>
          </div>
        ) : report ? (
          <>
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

            {report.expenses.length === 0 && report.deposits.length === 0 ? (
              <div className="empty-state">
                <Receipt size={48} className="empty-state-icon" />
                <div className="empty-state-title">
                  Нет операций за выбранный период
                </div>
              </div>
            ) : (
              <>
                <ReportCharts report={report} />

            {report.expenses.length > 0 && (
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
                                    background: data.color || 'var(--accent-primary)',
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

                {report.deposits.length > 0 && (
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
                {Object.keys(report.byDepositCategory || {}).length > 1 && (
                  <div className="deposit-totals">
                    {Object.entries(report.byDepositCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, total]) => (
                        <div key={name} className="deposit-total-row">
                          <span className="chart-legend-dot" style={{ background: 'var(--accent-primary)' }} />
                          <span className="deposit-total-name">{name}</span>
                          <span className="deposit-total-sum">
                            {formatMoney(total)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
                )}
              </>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={onClose}>
                Закрыть
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