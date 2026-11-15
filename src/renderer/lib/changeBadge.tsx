import { formatChange } from './format';

/**
 * Значок сравнения с прошлым периодом: «+12%» зелёным или «−8%» красным.
 *
 * Цвет зависит от направления: рост трат — плохо (красный), рост внесений —
 * хорошо (зелёный). Поэтому цвет задаётся вызывающей стороной через `goodWhen`,
 * а не вычисляется из знака — иначе «+12%» у трат и у внесений выглядели бы
 * одинаково при противоположном смысле.
 */
export function ChangeBadge({
  pct,
  goodWhen,
  title,
}: {
  pct: number | null;
  /** 'up' — рост хорош, 'down' — рост плох */
  goodWhen: 'up' | 'down';
  title?: string;
}) {
  const label = formatChange(pct);
  if (label === '0%' || label === 'новый') {
    return (
      <span className="change-badge neutral" title={title}>
        {label}
      </span>
    );
  }
  const up = label.startsWith('+');
  const good = goodWhen === 'up' ? up : !up;
  return (
    <span
      className={`change-badge ${good ? 'good' : 'bad'}`}
      title={title ?? `К прошлому периоду: ${label}`}
    >
      {label}
    </span>
  );
}
