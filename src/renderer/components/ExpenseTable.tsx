import { Trash2, CalendarDays, FileDown, Plus, Banknote, Receipt, Copy, Search, X } from 'lucide-react';
import type { Deposit, Expense, Period, PeriodPreset } from '../types';
import { formatMoney, getPeriodLabel, toISODate } from '../lib/format';
import { getCategoryIcon as getCategoryIconDef } from '../lib/icons';

export type MainTab = 'expenses' | 'deposits';

interface ExpenseTableProps {
  activeTab: MainTab;
  expenses: Expense[];
  deposits: Deposit[];
  period: Period;
  totalExpenses: number;
  totalDeposits: number;
  loading: boolean;
  onTabChange: (tab: MainTab) => void;
  onPeriodChange: (preset: PeriodPreset) => void;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
  onDeleteExpense: (id: number) => void;
  onDeleteDeposit: (id: number) => void;
  onAddExpense: () => void;
  onAddDeposit: () => void;
  onOpenReport: () => void;
  /** Открыть форму траты, предзаполненной выбранной строкой */
  onRepeatExpense: (expense: Expense) => void;
  onRepeatDeposit: (deposit: Deposit) => void;
  /** Фильтр по таблице: текст и диапазон сумм */
  filter: { text: string; min: string; max: string };
  onFilterChange: (filter: { text: string; min: string; max: string }) => void;
  /** Поле поиска — на него наводит фокус горячая клавиша Ctrl+F */
  searchRef: React.RefObject<HTMLInputElement>;
  /** Сколько записей скрыто текущим фильтром */
  hiddenCount: number;
}

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'День' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
];

function getBadgeClass(categoryName: string, isCustom: number): string {
  if (isCustom === 1) return 'custom';
  if (categoryName === 'Закуп') return 'zakup';
  if (categoryName === 'Такси') return 'taxi';
  return 'custom';
}

export default function ExpenseTable({
  activeTab,
  expenses,
  deposits,
  period,
  totalExpenses,
  totalDeposits,
  loading,
  onTabChange,
  onPeriodChange,
  onCustomStartChange,
  onCustomEndChange,
  onDeleteExpense,
  onDeleteDeposit,
  onAddExpense,
  onAddDeposit,
  onOpenReport,
  onRepeatExpense,
  onRepeatDeposit,
  filter,
  onFilterChange,
  searchRef,
  hiddenCount,
}: ExpenseTableProps) {
  const netChange = totalDeposits - totalExpenses;
  const hasFilter = filter.text !== '' || filter.min !== '' || filter.max !== '';

  return (
    <section className="content-area">
      <div className="content-header">
        <div className="content-title-block">
          <h1 className="content-title">
            {activeTab === 'expenses' ? 'Траты' : 'Внесения'}
          </h1>
          <div className="content-summary">
            {getPeriodLabel(period)} · Траты:{' '}
            <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>
              {formatMoney(totalExpenses)}
            </span>{' '}
            · Внесено:{' '}
            <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
              {formatMoney(totalDeposits)}
            </span>{' '}
            · Итого:{' '}
            <span
              style={{
                color: netChange >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)',
                fontWeight: 600,
              }}
            >
              {netChange >= 0 ? '+' : ''}
              {formatMoney(netChange)}
            </span>
          </div>
        </div>

        <div className="content-header-actions">
          <button className="btn btn-secondary" onClick={onAddExpense}>
            <Plus size={18} />
            Трата
          </button>

          <button className="btn btn-deposit" onClick={onAddDeposit}>
            <Banknote size={18} />
            Внесение
          </button>

          <button className="btn btn-primary" onClick={onOpenReport}>
            <FileDown size={18} />
            Отчёт
          </button>
        </div>
      </div>

      <div className="content-filters">
        <div className="period-selector">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`period-btn ${period.preset === p.key ? 'active' : ''}`}
              onClick={() => onPeriodChange(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="date-inputs">
          <input
            type="date"
            value={period.startDate}
            onChange={(e) => onCustomStartChange(e.target.value)}
            aria-label="Начало периода"
            style={{ width: 145 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>—</span>
          <input
            type="date"
            value={period.endDate}
            onChange={(e) => onCustomEndChange(e.target.value)}
            aria-label="Конец периода"
            style={{ width: 145 }}
            max={toISODate(new Date())}
          />
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'expenses' ? 'active' : ''}`}
          onClick={() => onTabChange('expenses')}
        >
          <Receipt size={16} />
          Траты
          {expenses.length > 0 && <span className="tab-count">{expenses.length}</span>}
        </button>
        <button
          className={`tab ${activeTab === 'deposits' ? 'active' : ''}`}
          onClick={() => onTabChange('deposits')}
        >
          <Banknote size={16} />
          Внесения
          {deposits.length > 0 && <span className="tab-count">{deposits.length}</span>}
        </button>
      </div>

      <div className="table-container">
        <div className="table-filter-bar">
          <div className="table-search">
            <Search size={15} />
            <input
              ref={searchRef}
              type="text"
              value={filter.text}
              placeholder="Поиск: комментарий, категория, сумма"
              onChange={(e) => onFilterChange({ ...filter, text: e.target.value })}
              aria-label="Поиск по таблице"
            />
            {filter.text !== '' && (
              <button
                className="table-search-clear"
                onClick={() => onFilterChange({ ...filter, text: '' })}
                title="Очистить"
                aria-label="Очистить поиск"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="table-amount-filter">
            <span>сумма</span>
            <input
              type="number"
              value={filter.min}
              placeholder="от"
              onChange={(e) => onFilterChange({ ...filter, min: e.target.value })}
              aria-label="Сумма от"
            />
            <span>—</span>
            <input
              type="number"
              value={filter.max}
              placeholder="до"
              onChange={(e) => onFilterChange({ ...filter, max: e.target.value })}
              aria-label="Сумма до"
            />
          </div>

          {hasFilter && (
            <span className="table-filter-note">
              Скрыто: {hiddenCount}
            </span>
          )}
        </div>

        {loading ? (
          <div className="empty-state">
            <p>Загрузка...</p>
          </div>
        ) : activeTab === 'expenses' ? (
          expenses.length === 0 ? (
            hasFilter ? (
              <div className="empty-state">
                <Search size={64} className="empty-state-icon" />
                <div className="empty-state-title">Ничего не найдено</div>
                <div className="empty-state-text">
                  Под фильтр не подошла ни одна трата за период
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => onFilterChange({ text: '', min: '', max: '' })}
                >
                  <X size={18} />
                  Сбросить фильтр
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <CalendarDays size={64} className="empty-state-icon" />
                <div className="empty-state-title">Нет трат за выбранный период</div>
                <button className="btn btn-primary" onClick={onAddExpense}>
                  <Plus size={18} />
                  Добавить первую трату
                </button>
              </div>
            )
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Дата</th>
                  <th>Категория</th>
                  <th style={{ width: 200 }}>Подкатегория</th>
                  <th style={{ textAlign: 'right', width: 140 }}>Сумма</th>
                  <th>Комментарий</th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => {
                  const isCustom =
                    expense.category_name !== 'Закуп' && expense.category_name !== 'Такси';
                  const badgeClass = getBadgeClass(expense.category_name, isCustom ? 1 : 0);
                  return (
                    <tr key={expense.id} className="expense-row">
                      <td className="date-cell">
                        {new Date(expense.date).toLocaleDateString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </td>
                      <td>
                        <div className="cat-cell">
                          {(() => {
                            const def = getCategoryIconDef(expense.category_icon);
                            const I = def.Icon;
                            return (
                              <I
                                size={15}
                                style={{
                                  color: def.color,
                                  background: `${def.color}22`,
                                  borderRadius: 6,
                                  padding: 3,
                                  boxSizing: 'content-box',
                                }}
                              />
                            );
                          })()}
                          <span className={`category-badge ${badgeClass}`}>
                            {expense.category_name}
                          </span>
                          {/* Заёмные деньги не считаются расходом в отчёте.
                              Метка объясняет, почему эта трата попала в
                              итог шапки, но не в «Траты» отчёта. */}
                          {expense.loan_id != null && (
                            <span className="loan-badge" title="Возврат займа — в отчёте идёт отдельной строкой">
                              заём
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {expense.subcategory_name || '—'}
                      </td>
                      <td className="amount-cell" style={{ textAlign: 'right' }}>
                        -{formatMoney(expense.amount)}
                      </td>
                      <td className="note-cell" title={expense.note || ''}>
                        {expense.note || '—'}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="action-btn"
                            onClick={() => onRepeatExpense(expense)}
                            title="Повторить — откроет форму, заполненную этой тратой"
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            className="action-btn"
                            onClick={() => onDeleteExpense(expense.id)}
                            title="Удалить трату"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600, padding: 16 }}>
                    Итого трат:
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 700,
                      color: 'var(--accent-danger)',
                      fontVariantNumeric: 'tabular-nums',
                      padding: 16,
                    }}
                  >
                    -{formatMoney(totalExpenses)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          )
        ) : deposits.length === 0 ? (
          hasFilter ? (
            <div className="empty-state">
              <Search size={64} className="empty-state-icon" />
              <div className="empty-state-title">Ничего не найдено</div>
              <div className="empty-state-text">
                Под фильтр не подошло ни одно внесение за период
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => onFilterChange({ text: '', min: '', max: '' })}
              >
                <X size={18} />
                Сбросить фильтр
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <Banknote size={64} className="empty-state-icon" />
              <div className="empty-state-title">Нет внесений за выбранный период</div>
              <button className="btn btn-deposit" onClick={onAddDeposit}>
                <Banknote size={18} />
                Внести деньги
              </button>
            </div>
          )
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Дата</th>
                <th>Категория</th>
                <th style={{ textAlign: 'right', width: 160 }}>Сумма</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id} className="expense-row">
                  <td className="date-cell">
                    {new Date(deposit.date).toLocaleDateString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="category-badge zakup">
                        <Banknote size={13} />
                        Внесение
                      </span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {deposit.category_name || 'Без категории'}
                      </span>
                      {/* Деньги займа попадают в остаток, но не в доходы */}
                      {deposit.loan_id != null && (
                        <span
                          className="loan-badge"
                          title="Деньги займа — в отчёте идут отдельной строкой"
                        >
                          заём
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="amount-cell income"
                    style={{ textAlign: 'right' }}
                  >
                    +{formatMoney(deposit.amount)}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="action-btn"
                        onClick={() => onRepeatDeposit(deposit)}
                        title="Повторить — откроет форму с этой суммой и категорией"
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        className="action-btn"
                        onClick={() => onDeleteDeposit(deposit.id)}
                        title="Удалить внесение"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600, padding: 16 }}>
                  Итого внесено:
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontWeight: 700,
                    color: 'var(--accent-primary)',
                    fontVariantNumeric: 'tabular-nums',
                    padding: 16,
                  }}
                >
                  +{formatMoney(totalDeposits)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}