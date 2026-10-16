import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShoppingCart,
  Car,
  Star,
  Settings,
  Plus,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import type { Category, Subcategory, Subitem } from '../types';
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
}: SidebarProps) {
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
      </div>
    </aside>
  );
}