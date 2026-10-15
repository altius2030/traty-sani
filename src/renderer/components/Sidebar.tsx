import { useState } from 'react';
import {
  ShoppingCart,
  Car,
  Star,
  Settings,
  Plus,
  Trash2,
  Wallet,
  Save,
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
  onSelectSubcategory: (subcategoryId: number) => void;
  onSelectSubitem: (subitemId: number) => void;
  onAddExpense: (categoryId: number, subcategoryId?: number, subitemId?: number) => void;
  onDeleteSubitem: (id: number) => void;
  onOpenCategoryManager: () => void;
  onOpenBalance: () => void;
  onMakeBackup: () => void;
  onDeleteCategory: (id: number) => void;
  onDeleteSubcategory: (id: number) => void;
}

function getCategoryIcon(name: string, iconKey?: string | null) {
  if (iconKey) {
    const def = getCategoryIconDef(iconKey);
    const I = def.Icon;
    return <I size={18} style={{ color: def.color }} />;
  }
  if (name === 'Закуп') return <ShoppingCart size={18} color="#ffffff" />;
  if (name === 'Такси') return <Car size={18} color="#ffffff" />;
  return <Star size={18} color="#ffffff" />;
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
  onOpenBalance,
  onMakeBackup,
  onDeleteCategory,
  onDeleteSubcategory,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const toggleExpand = (id: number) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isExpanded = (id: number) => expanded[id] ?? false;

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-title">Категории</div>
        <div className="category-list">
          {categories.map((cat) => {
            const subs: Subcategory[] = Array.isArray(cat.subcategories)
              ? (cat.subcategories as Subcategory[])
              : [];
            const isActive = selectedCategoryId === cat.id;
            const catClass = getCategoryClass(cat.name, cat.is_custom, cat.icon);

            return (
              <div key={cat.id}>
                <div
                  className={`category-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    toggleExpand(cat.id);
                    onSelectCategory(cat.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(cat.id);
                      onSelectCategory(cat.id);
                    }
                  }}
                >
                  <div className="category-info">
                    <div
                      className={`category-icon ${cat.icon ? '' : catClass}`}
                      style={
                        cat.icon
                          ? {
                              background: `${getCategoryIconDef(cat.icon).color}26`,
                              boxShadow: `inset 0 0 0 1px ${getCategoryIconDef(cat.icon).color}55`,
                            }
                          : undefined
                      }
                    >
                      {getCategoryIcon(cat.name, cat.icon)}
                    </div>
                    <span className="category-name">{cat.name}</span>
                  </div>
                  <div className="category-actions">
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddExpense(cat.id);
                      }}
                      title="Добавить трату"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCategory(cat.id);
                      }}
                      title="Удалить категорию"
                    >
                      <Trash2 size={14} color="var(--accent-danger)" />
                    </button>
                  </div>
                </div>

                {isExpanded(cat.id) && subs.length > 0 && (
                  <div className="subcategory-list">
                    {subs.map((sub) => {
                      const items: Subitem[] = Array.isArray(sub.items)
                        ? (sub.items as Subitem[])
                        : [];
                      return (
                      <div
                        key={sub.id}
                        className="subcategory-node"
                      >
                        <div
                          className={`subcategory-item ${
                            selectedSubcategoryId === sub.id ? 'selected' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSubcategory(sub.id);
                            onAddExpense(cat.id, sub.id);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectSubcategory(sub.id);
                              onAddExpense(cat.id, sub.id);
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
                                  onAddExpense(cat.id, sub.id, item.id);
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelectSubitem(item.id);
                                    onAddExpense(cat.id, sub.id, item.id);
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
                )}
              </div>
            );
          })}
        </div>

        <button className="add-btn" onClick={onOpenCategoryManager}>
          <Settings size={16} />
          Управление категориями
        </button>
      </div>

      <div className="sidebar-section" style={{ marginTop: 'auto' }}>
        <div className="sidebar-section-title">Баланс</div>
        <div
          style={{
            padding: '16px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Текущий остаток
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              color: currentBalance >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)',
            }}
          >
            {formatMoney(currentBalance)}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 6,
              lineHeight: 1.4,
            }}
          >
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
        <button className="add-btn" onClick={onOpenBalance} style={{ marginTop: 12 }}>
          <Wallet size={16} />
          Указать остаток
        </button>
        <button className="add-btn" onClick={onMakeBackup} style={{ marginTop: 8 }}>
          <Save size={16} />
          Резервная копия
        </button>
      </div>
    </aside>
  );
}