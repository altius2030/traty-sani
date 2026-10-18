import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShoppingCart,
  Car,
  Star,
  Settings,
  Plus,
  Trash2,
  ChevronDown,
  Pencil,
  X,
  Check,
  ArrowLeftRight,
} from 'lucide-react';
import type { Category, Subcategory, Subitem, RecurringItem, AccountBalance } from '../types';
import { RecurringBlock } from './Recurring';
import { formatMoney } from '../lib/format';
import { getCategoryIcon as getCategoryIconDef } from '../lib/icons';

interface SidebarProps {
  categories: Category[];
  selectedCategoryId: number | null;
  selectedSubcategoryId: number | null;
  selectedSubitemId: number | null;
  currentBalance: number;
  baseCheckpoint: { amount: number; date: string | null };
  onSelectCategory: (categoryId: number) => void;
  onSelectSubcategory: (subcategoryId: number | null) => void;
  onSelectSubitem: (subitemId: number | null) => void;
  onAddExpense: (categoryId: number, subcategoryId?: number, subitemId?: number) => void;
  onDeleteSubitem: (id: number) => void;
  onOpenCategoryManager: () => void;
  onDeleteCategory: (id: number) => void;
  onDeleteSubcategory: (id: number) => void;
  /** Регулярные платежи, срок которых наступил */
  recurring: RecurringItem[];
  /** Сколько постоянных расходов выходит в месяц */
  recurringMonthly: number;
  onPayRecurring: (id: number) => void;
  onOpenRecurringManager: () => void;
  /** Счета с их остатками: сумма по всем и есть общий остаток */
  accounts: AccountBalance[];
  /** Выбранный счёт; null — показываем все */
  selectedAccountId: number | null;
  onSelectAccount: (id: number | null) => void;
  onAddAccount: (name: string) => Promise<void>;
  onRenameAccount: (id: number, name: string) => Promise<void>;
  onDeleteAccount: (id: number) => void;
  onOpenTransfer: () => void;
}

const WIDTH_KEY = 'traty-sidebar-width';
const MIN_WIDTH = 200;
const MAX_WIDTH = 440;

function getCategoryIcon(name: string, iconKey?: string | null) {
  if (iconKey) {
    const def = getCategoryIconDef(iconKey);
    const I = def.Icon;
    return <I size={20} style={{ color: def.color }} />;
  }
  if (name === 'Закуп') return <ShoppingCart size={20} color="#ffffff" />;
  if (name === 'Такси') return <Car size={20} color="#ffffff" />;
  return <Star size={20} color="#ffffff" />;
}

function getCategoryClass(name: string, isCustom: number, iconKey?: string | null): string {
  // Свой значок — свой цвет фона, чтобы категории различались
  if (iconKey) return 'custom';
  if (isCustom === 1) return 'custom';
  if (name === 'Закуп') return 'zakup';
  if (name === 'Такси') return 'taxi';
  return 'custom';
}

export default function Sidebar({
  categories,
  selectedCategoryId,
  selectedSubcategoryId,
  selectedSubitemId,
  currentBalance,
  baseCheckpoint,
  onSelectCategory,
  onSelectSubcategory,
  onSelectSubitem,
  onAddExpense,
  onDeleteSubitem,
  onOpenCategoryManager,
  onDeleteCategory,
  onDeleteSubcategory,
  recurring,
  recurringMonthly,
  onPayRecurring,
  onOpenRecurringManager,
  accounts,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
  onRenameAccount,
  onDeleteAccount,
  onOpenTransfer,
}: SidebarProps) {
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [editingAccount, setEditingAccount] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Раскрытая категория: плитка → выезжающий список её подкатегорий
  const [openId, setOpenId] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH
      ? saved
      : 280;
  });

  const sidebarRef = useRef<HTMLElement>(null);

  // Перетаскивание правой границы панели
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = e.currentTarget.parentElement?.offsetWidth ?? 280;

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX))
      );
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
        return w;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Двойной клик по границе возвращает ширину по умолчанию
  const resetWidth = () => {
    setWidth(280);
    localStorage.setItem(WIDTH_KEY, '280');
  };

  // Клик вне панели закрывает выезжающий список
  useEffect(() => {
    if (openId === null) return;
    const onClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setOpenId(null);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [openId]);

  const handleTileClick = (cat: Category) => {
    const next = openId === cat.id ? null : cat.id;
    setOpenId(next);
    onSelectCategory(cat.id);
    if (next === null) {
      onSelectSubcategory(null);
      onSelectSubitem(null);
    }
  };

  const open = categories.find((c) => c.id === openId);

  return (
    <aside className="sidebar" ref={sidebarRef} style={{ width }}>
      <div className="sidebar-resize-handle" onMouseDown={startResize} onDoubleClick={resetWidth}>
        <span className="sidebar-resize-grip" />
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Категории</div>

        {/* Плитки — как на телефоне: значок сверху, подпись под ним */}
        <div className="tile-grid">
          {categories.map((cat) => {
            const subs: Subcategory[] = Array.isArray(cat.subcategories)
              ? (cat.subcategories as Subcategory[])
              : [];
            const isOpen = openId === cat.id;
            const catClass = getCategoryClass(cat.name, cat.is_custom, cat.icon);
            const iconColor = cat.icon ? getCategoryIconDef(cat.icon).color : null;

            return (
              <button
                key={cat.id}
                className={`tile ${isOpen ? 'open' : ''} ${
                  selectedCategoryId === cat.id && !isOpen ? 'active' : ''
                }`}
                onClick={() => handleTileClick(cat)}
                title={cat.name}
                aria-expanded={isOpen}
              >
                <span
                  className={`tile-icon ${cat.icon ? '' : catClass}`}
                  style={
                    iconColor
                      ? {
                          background: `${iconColor}26`,
                          boxShadow: `inset 0 0 0 1px ${iconColor}55`,
                        }
                      : undefined
                  }
                >
                  {getCategoryIcon(cat.name, cat.icon)}
                  {subs.length > 0 && <span className="tile-badge">{subs.length}</span>}
                </span>
                <span className="tile-name">{cat.name}</span>
              </button>
            );
          })}
        </div>

        {/* Выезжающий список подкатегорий выбранной плитки */}
        {open && (
          <div className="tile-panel">
            <div className="tile-panel-head">
              <button
                className="btn btn-secondary tile-panel-add"
                onClick={() => onAddExpense(open.id)}
                title="Добавить трату без подкатегории"
              >
                <Plus size={14} />
                Трата
              </button>
              <span className="tile-panel-title">{open.name}</span>
              <button
                className="action-btn"
                onClick={() => onDeleteCategory(open.id)}
                title="Удалить категорию"
              >
                <Trash2 size={15} color="var(--accent-danger)" />
              </button>
              <button
                className="action-btn"
                onClick={() => setOpenId(null)}
                title="Свернуть"
              >
                <ChevronDown size={16} />
              </button>
            </div>

            {(() => {
              const subs: Subcategory[] = Array.isArray(open.subcategories)
                ? (open.subcategories as Subcategory[])
                : [];
              if (subs.length === 0) {
                return <div className="empty-hint">Подкатегорий пока нет</div>;
              }
              return (
                <div className="tile-panel-list">
                  {subs.map((sub) => {
                    const items: Subitem[] = Array.isArray(sub.items)
                      ? (sub.items as Subitem[])
                      : [];
                    return (
                      <div key={sub.id} className="subcategory-node">
                        <div
                          className={`subcategory-item ${
                            selectedSubcategoryId === sub.id ? 'selected' : ''
                          }`}
                          onClick={() => {
                            onSelectSubcategory(sub.id);
                            onSelectSubitem(null);
                            onAddExpense(open.id, sub.id);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectSubcategory(sub.id);
                              onAddExpense(open.id, sub.id);
                            }
                          }}
                        >
                          <span>{sub.name}</span>
                          <button
                            className="action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSubcategory(sub.id);
                            }}
                            title="Удалить подкатегорию"
                          >
                            <Trash2 size={13} color="var(--accent-danger)" />
                          </button>
                        </div>

                        {/* Третий уровень — статьи */}
                        {items.length > 0 && (
                          <div className="subitem-list">
                            {items.map((item) => (
                              <div
                                key={item.id}
                                className={`subcategory-item subitem-item ${
                                  selectedSubitemId === item.id ? 'selected' : ''
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectSubcategory(sub.id);
                                  onSelectSubitem(item.id);
                                  onAddExpense(open.id, sub.id, item.id);
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelectSubitem(item.id);
                                    onAddExpense(open.id, sub.id, item.id);
                                  }
                                }}
                              >
                                <span>{item.name}</span>
                                <button
                                  className="action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSubitem(item.id);
                                  }}
                                  title="Удалить статью"
                                >
                                  <Trash2 size={11} color="var(--accent-danger)" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        <button className="add-btn" onClick={onOpenCategoryManager}>
          <Settings size={16} />
          Управление категориями
        </button>

        <RecurringBlock
          items={recurring}
          monthlyTotal={recurringMonthly}
          onPay={onPayRecurring}
          onOpenManager={onOpenRecurringManager}
        />
      </div>

      <div className="sidebar-section" style={{ marginTop: 'auto' }}>
        <div className="sidebar-section-title">Баланс</div>
        <div className="sidebar-balance">
          <div className="sidebar-balance-label">Текущий остаток</div>
          <div
            className="sidebar-balance-value"
            style={{
              color: currentBalance >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)',
            }}
          >
            {formatMoney(currentBalance)}
          </div>
          <div className="sidebar-balance-hint">
            {baseCheckpoint.date ? (
              <>
                отметка {formatMoney(baseCheckpoint.amount)} от{' '}
                {new Date(baseCheckpoint.date).toLocaleDateString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  year: '2-digit',
                })}
                <br />
                + все внесения и траты после неё
              </>
            ) : (
              <>отметки не заданы — учитываются все операции</>
            )}
          </div>
        </div>

        {/* Счета. Их сумма и есть «текущий остаток» выше: карточки показывают,
            из чего он складывается, и позволяют уйти в один счёт. */}
        <div className="account-list">
          <div className="account-list-head">
            <span>Счета</span>
            <div className="account-list-actions">
              <button
                className="account-add-btn"
                onClick={() => setNewAccountOpen((v) => !v)}
                title="Добавить счёт"
                aria-label="Добавить счёт"
              >
                <Plus size={14} />
              </button>
              <button
                className="account-add-btn"
                onClick={onOpenTransfer}
                title="Перевод между счетами"
                aria-label="Перевод между счетами"
              >
                <ArrowLeftRight size={14} />
              </button>
            </div>
          </div>

          {newAccountOpen && (
            <form
              className="account-new"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newAccountName.trim();
                if (!name) return;
                try {
                  await onAddAccount(name);
                  setNewAccountName('');
                  setNewAccountOpen(false);
                } catch {
                  /* ошибку покажет тост в App.tsx */
                }
              }}
            >
              <input
                autoFocus
                value={newAccountName}
                placeholder="Название счёта…"
                maxLength={60}
                onChange={(e) => setNewAccountName(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary" disabled={!newAccountName.trim()}>
                <Plus size={12} />
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setNewAccountOpen(false)}>
                <X size={13} />
              </button>
            </form>
          )}

          <button
            className={`account-row account-row-all ${selectedAccountId === null ? 'active' : ''}`}
            onClick={() => onSelectAccount(null)}
          >
            <span className="account-row-name">Все счета</span>
            <span className="account-row-sum">
              {formatMoney(accounts.reduce((s, a) => s + a.balance, 0))}
            </span>
          </button>

          {accounts.map((a) => (
            <div key={a.id} className={`account-row ${selectedAccountId === a.id ? 'active' : ''}`}>
              <button
                className="account-row-main"
                onClick={() => onSelectAccount(selectedAccountId === a.id ? null : a.id)}
                title={`${a.name}: ${formatMoney(a.balance)}`}
              >
                <span
                  className="account-dot"
                  style={{ background: a.color || 'var(--accent-primary)' }}
                />
                <span className="account-row-name">{a.name}</span>
                {a.is_default === 1 && <span className="account-default-badge">осн.</span>}
              </button>
              <span
                className="account-row-sum"
                style={{ color: a.balance < 0 ? 'var(--accent-danger)' : undefined }}
              >
                {formatMoney(a.balance)}
              </span>
              {editingAccount === a.id ? (
                <form
                  className="account-rename"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const draft = renameDraft.trim();
                    if (!draft) return;
                    try {
                      await onRenameAccount(a.id, draft);
                      setEditingAccount(null);
                    } catch {
                      /* тост */
                    }
                  }}
                >
                  <input
                    className="rename-input"
                    style={{ fontSize: 12 }}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingAccount(null);
                    }}
                  />
                  <button type="submit" className="action-btn" aria-label="Сохранить">
                    <Check size={12} color="var(--accent-success)" />
                  </button>
                  <button type="button" className="action-btn" onClick={() => setEditingAccount(null)} aria-label="Отмена">
                    <X size={12} />
                  </button>
                </form>
              ) : (
                <div className="account-row-actions">
                  <button
                    className="action-btn"
                    onClick={() => {
                      setRenameDraft(a.name);
                      setEditingAccount(a.id);
                    }}
                    title="Переименовать счёт"
                    aria-label={`Переименовать счёт ${a.name}`}
                  >
                    <Pencil size={12} />
                  </button>
                  {a.is_default !== 1 && (
                    <button
                      className="action-btn"
                      onClick={() => onDeleteAccount(a.id)}
                      title="Удалить счёт. Операции перейдут на основной."
                      aria-label={`Удалить счёт ${a.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}