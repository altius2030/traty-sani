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
  ChevronRight,
  ChevronDown,
  Printer,
} from 'lucide-react';
import type { Period, Report, AccountBalance, Category } from '../types';
import { formatMoney, getPeriodLabel, previousPeriod, percentChange, monthBounds, toISODate } from '../lib/format';
import { depositColorMap, expenseColorMap } from '../lib/reportColors';
import { ChangeBadge } from '../lib/changeBadge';

interface ReportModalProps {
  period: Period;
  accounts: AccountBalance[];
  defaultAccountId: number | null;
  /** Категории трат — для фильтра отчёта */
  categories: Category[];
  onClose: () => void;
  onExport: (report: Report, period: Period, accountName?: string, categoryName?: string) => void;
  onExportXlsx: (report: Report, period: Period, accountName?: string, categoryName?: string) => void;
}

type ReportTab = 'all' | 'expenses' | 'deposits' | 'year';

const TABS: { id: ReportTab; label: string }[] = [
  { id: 'all', label: 'Общий отчёт' },
  { id: 'expenses', label: 'Траты' },
  { id: 'deposits', label: 'Внесения' },
  { id: 'year', label: 'За год' },
];

export default function ReportModal({ period, accounts, defaultAccountId, categories, onClose, onExport, onExportXlsx }: ReportModalProps) {
  const [report, setReport] = useState<Report | null>(null);
  /** Отчёт за предыдущий период той же длины — для сравнения */
  const [prevReport, setPrevReport] = useState<Report | null>(null);
  const [tab, setTab] = useState<ReportTab>('all');
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(defaultAccountId);
  /** Раскрытая категория — под ней показываются её операции */
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  /** Фильтр по категории трат. null — все категории */
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  /**
   * Собственный период отчёта. Отличается от периода таблицы: отчёт можно
   * открыть за квартал, не переключая основной экран. Стартует с периода
   * таблицы, но живёт своей жизнью, пока открыто окно.
   */
  const [reportStart, setReportStart] = useState(period.startDate);
  const [reportEnd, setReportEnd] = useState(period.endDate);
  /** Сводка по месяцам — грузится только на вкладке «За год» */
  const [yearData, setYearData] = useState<{ year: number; months: { month: string; deposits: number; expenses: number; net: number }[] } | null>(null);

  // Точки в таблицах берут те же цвета, что и сектора диаграмм
  const expenseColors = report ? expenseColorMap(report) : {};
  const depositColors = report ? depositColorMap(report) : {};
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Прошлый период нужен только для сравнения. Если он не загрузится —
    // отчёт всё равно должен показываться, просто без значков сравнения.
    const prev = previousPeriod(reportStart, reportEnd);
    Promise.all([
      window.electronAPI.getReport(reportStart, reportEnd, selectedAccountId, selectedCategoryId),
      window.electronAPI.getReport(prev.startDate, prev.endDate, selectedAccountId, selectedCategoryId).catch(() => null),
    ])
      .then(([data, prevData]: [Report, Report | null]) => {
        if (!cancelled) {
          setReport(data);
          setPrevReport(prevData);
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
  }, [reportStart, reportEnd, selectedAccountId, selectedCategoryId]);

  // Сводка по месяцам — год берём из даты конца отчёта. Грузится лениво,
  // только когда открыли вкладку: данные не нужны остальным вкладкам.
  useEffect(() => {
    if (tab !== 'year') return;
    let cancelled = false;
    const year = new Date(`${reportEnd}T00:00:00`).getFullYear();
    window.electronAPI
      .getYearSummary(year, selectedAccountId)
      .then((data) => { if (!cancelled) setYearData(data); })
      .catch(() => { if (!cancelled) setYearData(null); });
    return () => { cancelled = true; };
  }, [tab, reportEnd, selectedAccountId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        {/* Шапка и вкладки липкие: при прокрутке длинного отчёта заголовок
            и переключатель вкладок остаются на виду */}
        <div className="report-head">
          <div className="modal-header">
            <h2 className="modal-title">
              Отчёт: {getPeriodLabel({ preset: 'custom', startDate: reportStart, endDate: reportEnd })}
            </h2>
            <button className="modal-close" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>

          {/* Собственный период отчёта — не зависит от периода таблицы */}
          <div className="report-period">
            <input
              type="date"
              value={reportStart}
              onChange={(e) => setReportStart(e.target.value)}
              aria-label="Начало отчёта"
            />
            <span style={{ color: 'var(--text-muted)' }}>—</span>
            <input
              type="date"
              value={reportEnd}
              onChange={(e) => setReportEnd(e.target.value)}
              aria-label="Конец отчёта"
            />
            {/* Возврат к периоду таблицы — если отчёт отъехал от него */}
            {(reportStart !== period.startDate || reportEnd !== period.endDate) && (
              <button
                className="btn btn-ghost"
                style={{ padding: '4px 8px', fontSize: 12 }}
                onClick={() => { setReportStart(period.startDate); setReportEnd(period.endDate); }}
                title="Вернуть период таблицы"
              >
                Период таблицы
              </button>
            )}
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

          {/* Счёт для отчёта: по умолчанию — основной счёт, но можно выбрать
              любой другой. Отчёт строится по операциям выбранного счёта,
              а не по всем счетам вместе. */}
          <div className="report-filters">
            {accounts.length > 0 && (
              <div className="report-account">
                <label className="form-label" htmlFor="report-account" style={{ marginRight: 8 }}>
                  Счёт
                </label>
                <select
                  id="report-account"
                  value={selectedAccountId ?? ''}
                  onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
                >
                  {/* «Все счета» — сводный отчёт без разбивки по счетам. Нужен,
                      когда вопрос не «сколько на карте», а «сколько всего». */}
                  <option value="">Все счета</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {formatMoney(a.balance)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {categories.length > 0 && (
              <div className="report-account">
                <label className="form-label" htmlFor="report-category" style={{ marginRight: 8 }}>
                  Категория
                </label>
                <select
                  id="report-category"
                  value={selectedCategoryId ?? ''}
                  onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Все категории</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  {/* Записи, чья категория была удалена, остаются с NULL.
                      Их тоже надо уметь посмотреть отдельно. */}
                  <option value="-1">Без категории</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <p>Загрузка отчёта...</p>
          </div>
        ) : report ? (
          <>
            {/* Отчёт по категории: балансовые карточки здесь не показываем —
                они считаются по всем операциям и с частичной выборкой трат
                просто не сходятся. Вместо них свои итоги категории. */}
            {tab === 'all' && report.categoryFiltered && (
              <div className="report-summary">
                <div className="summary-card">
                  <div className="summary-label">Категория</div>
                  <div className="summary-value neutral" style={{ fontSize: 15 }}>
                    {selectedCategoryId === -1
                      ? 'Без категории'
                      : categories.find((c) => c.id === selectedCategoryId)?.name ?? '—'}
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">
                    <TrendingDown size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Траты по категории
                  </div>
                  <div className="summary-value negative">
                    −{formatMoney(report.totalExpenses)}
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Операций</div>
                  <div className="summary-value neutral">{report.expenses.length}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Средняя трата</div>
                  <div className="summary-value neutral">
                    {formatMoney(
                      report.expenses.length ? report.totalExpenses / report.expenses.length : 0
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'all' && !report.categoryFiltered && (
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
                  {prevReport && (
                    <ChangeBadge
                      pct={percentChange(report.totalDeposits, prevReport.totalDeposits)}
                      goodWhen="up"
                      title={`Прошлый период: ${formatMoney(prevReport.totalDeposits)}`}
                    />
                  )}
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
                  {prevReport && (
                    <ChangeBadge
                      pct={percentChange(report.totalExpenses, prevReport.totalExpenses)}
                      goodWhen="down"
                      title={`Прошлый период: ${formatMoney(prevReport.totalExpenses)}`}
                    />
                  )}
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
                  {prevReport && (
                    <ChangeBadge
                      pct={percentChange(report.endBalance, prevReport.endBalance)}
                      goodWhen="up"
                      title={`Прошлый период: ${formatMoney(prevReport.endBalance)}`}
                    />
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Разбивка кредитов. В карточках выше это одно число «взято минус
                возвращено», здесь видно, из чего оно сложилось. */}
            {tab === 'all' && !report.categoryFiltered && (report.loanTaken > 0 || report.loanRepaid > 0) && (
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
            {tab === 'all' && !report.categoryFiltered && report.withheldByAggregators > 0 && (
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

            {tab === 'all' && !report.categoryFiltered && (
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

            {(() => {
              // Прогноз на конец месяца: берём траты периода, делим на число
              // прошедших дней месяца и экстраполируем на остаток месяца.
              // Показываем только для текущего месяца и только если данные
              // не за весь месяц — иначе прогноз равен факту и только путает.
              if (report.categoryFiltered) return null;
              const { start: mStart, end: mEnd } = monthBounds(reportEnd);
              const today = toISODate(new Date());
              const effectiveEnd = reportEnd > today ? today : reportEnd;
              if (effectiveEnd < mStart || effectiveEnd > mEnd) return null;
              const elapsedDays =
                Math.round(
                  (new Date(`${effectiveEnd}T00:00:00`).getTime() -
                    new Date(`${mStart}T00:00:00`).getTime()) /
                    86400000
                ) + 1;
              const totalDays =
                Math.round(
                  (new Date(`${mEnd}T00:00:00`).getTime() -
                    new Date(`${mStart}T00:00:00`).getTime()) /
                    86400000
                ) + 1;
              if (elapsedDays >= totalDays || report.totalExpenses <= 0) return null;
              const avgDaily = report.totalExpenses / elapsedDays;
              const remaining = totalDays - elapsedDays;
              const projected = report.endBalance - avgDaily * remaining;
              const monthLabel = new Date(`${mStart}T00:00:00`).toLocaleDateString('ru-RU', {
                month: 'long',
              });
              return (
                <div className="forecast-card">
                  <div className="summary-label" style={{ marginBottom: 4 }}>
                    Прогноз на конец {monthLabel}
                  </div>
                  <div className="forecast-row">
                    <span>В среднем в день</span>
                    <strong>{formatMoney(avgDaily)}</strong>
                  </div>
                  <div className="forecast-row">
                    <span>Осталось дней</span>
                    <strong>{remaining}</strong>
                  </div>
                  <div className="forecast-row">
                    <span>Остаток к концу месяца</span>
                    <strong
                      style={{
                        color: projected >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)',
                      }}
                    >
                      ≈ {formatMoney(projected)}
                    </strong>
                  </div>
                </div>
              );
            })()}

            {report.baseCheckpoint.date && (              <div
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

            {/* Вкладка «За год» — сводная таблица по месяцам. Графики здесь
                не нужны: вопрос не «из чего», а «как шёл год». */}
            {tab === 'year' && (
              <div className="report-breakdown">
                <div className="breakdown-title">
                  Сводка за {yearData?.year ?? new Date(`${reportEnd}T00:00:00`).getFullYear()} год
                  {selectedAccountId === null && ' · все счета'}
                </div>
                {!yearData ? (
                  <div className="empty-state">
                    <p>Загрузка…</p>
                  </div>
                ) : (
                  <table className="breakdown-table">
                    <thead>
                      <tr>
                        <th>Месяц</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Внесения</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Траты</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Итого</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearData.months.map((m) => (
                        <tr key={m.month}>
                          <td>
                            {new Date(`${yearData.year}-${m.month}-01T00:00:00`).toLocaleDateString('ru-RU', {
                              month: 'long',
                            })}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--accent-primary)' }}>
                            +{formatMoney(m.deposits)}
                          </td>
                          <td style={{ textAlign: 'right', color: m.expenses > 0 ? 'var(--accent-danger)' : undefined }}>
                            −{formatMoney(m.expenses)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 600,
                              color: m.net >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)',
                            }}
                          >
                            {m.net >= 0 ? '+' : '−'}
                            {formatMoney(Math.abs(m.net))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>
                          <strong>Итого за год</strong>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>
                            +{formatMoney(yearData.months.reduce((s, m) => s + m.deposits, 0))}
                          </strong>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>
                            −{formatMoney(yearData.months.reduce((s, m) => s + m.expenses, 0))}
                          </strong>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>
                            {(() => {
                              const net = yearData.months.reduce((s, m) => s + m.net, 0);
                              return (
                                <span style={{ color: net >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)' }}>
                                  {net >= 0 ? '+' : '−'}{formatMoney(Math.abs(net))}
                                </span>
                              );
                            })()}
                          </strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )}

            {tab !== 'year' && !((tab === 'expenses' && report.expenses.length === 0) ||
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
                          {prevReport && (
                            <th style={{ textAlign: 'right', width: 74 }} title="Сравнение с прошлым периодом">
                              Δ
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(report.byCategory).map(([catName, data]) => {
                          const expanded = expandedCategory === catName;
                          // Операции этой категории — раскрываются по клику.
                          // Сортируем по убыванию суммы: сначала самые крупные.
                          const items = report.expenses
                            .filter((e) => (e.category_name || 'Без категории') === catName)
                            .sort((a, b) => b.amount - a.amount);
                          return (
                          <Fragment key={catName}>
                            <tr
                              className={`breakdown-category-row ${expanded ? 'expanded' : ''}`}
                              onClick={() => setExpandedCategory(expanded ? null : catName)}
                              title={expanded ? 'Свернуть' : 'Показать операции категории'}
                            >
                              <td className="breakdown-category">
                                {items.length > 0 ? (
                                  expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                                ) : (
                                  <span style={{ width: 14, display: 'inline-block' }} />
                                )}
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
                              {prevReport && (
                                <td style={{ textAlign: 'right' }}>
                                  <ChangeBadge
                                    pct={percentChange(data.total, prevReport.byCategory[catName]?.total ?? 0)}
                                    goodWhen="down"
                                    title={`Прошлый период: ${formatMoney(prevReport.byCategory[catName]?.total ?? 0)}`}
                                  />
                                </td>
                              )}
                            </tr>
                            {expanded && items.map((e) => (
                              <tr key={`op-${catName}-${e.id}`} className="breakdown-op">
                                <td className="breakdown-op-cell">
                                  <span className="breakdown-op-date">
                                    {new Date(e.date).toLocaleDateString('ru-RU', {
                                      day: '2-digit',
                                      month: '2-digit',
                                    })}
                                  </span>
                                  {e.note ? <span className="breakdown-op-note">{e.note}</span> : null}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  −{formatMoney(e.amount)}
                                </td>
                                {prevReport && <td />}
                              </tr>
                            ))}
                            {Object.entries(data.subcategories).map(([subName, sub]) => (
                              <Fragment key={`${catName}-${subName}`}>
                                <tr>
                                  <td className="breakdown-subcategory">└ {subName}</td>
                                  <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                                    {formatMoney(sub.total)}
                                  </td>
                                  {prevReport && <td />}
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
                                    {prevReport && <td />}
                                  </tr>
                                ))}
                              </Fragment>
                            ))}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Крупнейшие траты периода — часто именно они объясняют всю
                    картину, а не размазанные по категориям суммы */}
                {(tab === 'all' || tab === 'expenses') && report.expenses.length > 0 && (
                  <div className="report-breakdown">
                    <div className="breakdown-title">Крупнейшие траты</div>
                    <table className="breakdown-table">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th>Категория</th>
                          <th style={{ textAlign: 'right', width: 160 }}>Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...report.expenses]
                          .sort((a, b) => b.amount - a.amount)
                          .slice(0, 7)
                          .map((e) => (
                            <tr key={`top-${e.id}`}>
                              <td className="date-cell">
                                {new Date(e.date).toLocaleDateString('ru-RU', {
                                  day: '2-digit',
                                  month: '2-digit',
                                })}
                              </td>
                              <td>
                                {e.category_name || 'Без категории'}
                                {e.note ? (
                                  <span className="breakdown-op-note" style={{ marginLeft: 8 }}>
                                    {e.note}
                                  </span>
                                ) : null}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                −{formatMoney(e.amount)}
                              </td>
                            </tr>
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
              {/* Печать: системный диалог, где можно выбрать «Сохранить как PDF».
                  Отчёт печатается через отдельную раскладку — см. print-CSS. */}
              <button className="btn btn-secondary" onClick={() => window.print()}>
                <Printer size={18} />
                Печать / PDF
              </button>
              <button className="btn btn-secondary" onClick={() => onExportXlsx(report, { preset: 'custom', startDate: reportStart, endDate: reportEnd }, accounts.find(a => a.id === selectedAccountId)?.name, selectedCategoryId ? (selectedCategoryId === -1 ? 'Без категории' : categories.find(c => c.id === selectedCategoryId)?.name) : undefined)}>
                <Sheet size={18} />
                Экспорт в Excel
              </button>
              <button className="btn btn-primary" onClick={() => onExport(report, { preset: 'custom', startDate: reportStart, endDate: reportEnd }, accounts.find(a => a.id === selectedAccountId)?.name, selectedCategoryId ? (selectedCategoryId === -1 ? 'Без категории' : categories.find(c => c.id === selectedCategoryId)?.name) : undefined)}>
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