import {
  ShoppingCart,
  Car,
  Truck,
  Fuel,
  Home,
  Building2,
  Utensils,
  Coffee,
  ShoppingBag,
  Shirt,
  Watch,
  Scissors,
  HeartPulse,
  Dumbbell,
  GraduationCap,
  Baby,
  PawPrint,
  Gift,
  Plane,
  Bed,
  Phone,
  Wifi,
  Tv,
  Gamepad2,
  Wrench,
  Hammer,
  Droplets,
  Zap,
  Banknote,
  Wallet,
  Briefcase,
  Boxes,
  Package,
  Flower2,
  TreePine,
  Fish,
  Flame,
  Snowflake,
  CircleDot,
  Star,
  type LucideIcon,
} from 'lucide-react';

/**
 * Набор значков для категорий. Каждый — со своим цветом, чтобы категории
 * различались не только названием. Ключ хранится в БД (categories.icon).
 */
export interface CategoryIconDef {
  key: string;
  label: string;
  color: string;
  Icon: LucideIcon;
}

export const CATEGORY_ICONS: CategoryIconDef[] = [
  // Товары и продукты
  { key: 'cart', label: 'Корзина', color: '#00d4aa', Icon: ShoppingCart },
  { key: 'bag', label: 'Сумка', color: '#ff6b6b', Icon: ShoppingBag },
  { key: 'boxes', label: 'Коробки', color: '#f59e0b', Icon: Boxes },
  { key: 'package', label: 'Посылка', color: '#94a3b8', Icon: Package },
  { key: 'fish', label: 'Рыба', color: '#38bdf8', Icon: Fish },
  { key: 'flame', label: 'Огонь', color: '#fb923c', Icon: Flame },
  { key: 'droplets', label: 'Вода', color: '#60a5fa', Icon: Droplets },
  { key: 'flower', label: 'Цветы', color: '#f472b6', Icon: Flower2 },
  { key: 'tree', label: 'Природа', color: '#4ade80', Icon: TreePine },

  // Транспорт
  { key: 'car', label: 'Машинка', color: '#3b82f6', Icon: Car },
  { key: 'truck', label: 'Грузовик', color: '#6366f1', Icon: Truck },
  { key: 'fuel', label: 'Топливо', color: '#eab308', Icon: Fuel },
  { key: 'plane', label: 'Перелёты', color: '#818cf8', Icon: Plane },

  // Дом и быт
  { key: 'home', label: 'Дом', color: '#22c55e', Icon: Home },
  { key: 'building', label: 'Здание', color: '#64748b', Icon: Building2 },
  { key: 'wrench', label: 'Ремонт', color: '#f97316', Icon: Wrench },
  { key: 'hammer', label: 'Инструменты', color: '#a16207', Icon: Hammer },
  { key: 'zap', label: 'Электричество', color: '#eab308', Icon: Zap },
  { key: 'bed', label: 'Дом/быт', color: '#c084fc', Icon: Bed },

  // Еда
  { key: 'food', label: 'Еда', color: '#fbbf24', Icon: Utensils },
  { key: 'coffee', label: 'Кофе', color: '#a16207', Icon: Coffee },

  // Здоровье и спорт
  { key: 'health', label: 'Здоровье', color: '#ef4444', Icon: HeartPulse },
  { key: 'sport', label: 'Спорт', color: '#10b981', Icon: Dumbbell },

  // Одежда и услуги
  { key: 'shirt', label: 'Одежда', color: '#8b5cf6', Icon: Shirt },
  { key: 'watch', label: 'Часы', color: '#d946ef', Icon: Watch },
  { key: 'barber', label: 'Сало��', color: '#ec4899', Icon: Scissors },

  // Дети и животные
  { key: 'baby', label: 'Дети', color: '#f9a8d4', Icon: Baby },
  { key: 'paw', label: 'Животные', color: '#a3a3a3', Icon: PawPrint },
  { key: 'gift', label: 'Подарки', color: '#f43f5e', Icon: Gift },
  { key: 'education', label: 'Учёба', color: '#0ea5e9', Icon: GraduationCap },

  // Связь и техника
  { key: 'phone', label: 'Телефон', color: '#6366f1', Icon: Phone },
  { key: 'wifi', label: 'Интернет', color: '#0d9488', Icon: Wifi },
  { key: 'tv', label: 'ТВ', color: '#7c3aed', Icon: Tv },
  { key: 'game', label: 'Игры', color: '#8b5cf6', Icon: Gamepad2 },

  // Деньги и прочее
  { key: 'money', label: 'Деньги', color: '#22c55e', Icon: Banknote },
  { key: 'wallet', label: 'Кошелёк', color: '#f59e0b', Icon: Wallet },
  { key: 'work', label: 'Работа', color: '#475569', Icon: Briefcase },
  { key: 'snow', label: 'Зима', color: '#7dd3fc', Icon: Snowflake },
  { key: 'other', label: 'Прочее', color: '#a855f7', Icon: CircleDot },
  { key: 'star', label: 'Звезда', color: '#facc15', Icon: Star },
];

const BY_KEY = new Map(CATEGORY_ICONS.map((i) => [i.key, i]));

/** Значок по ключу; при неизвестном ключе — первая иконка категории */
export function getCategoryIcon(key?: string | null): CategoryIconDef {
  if (key) {
    const found = BY_KEY.get(key);
    if (found) return found;
  }
  return CATEGORY_ICONS[0];
}

/** Цвет без иконки — для бейджей и подсветки в отчёте */
export function getCategoryColor(key?: string | null): string {
  return getCategoryIcon(key).color;
}