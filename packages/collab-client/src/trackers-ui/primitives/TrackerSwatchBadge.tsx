/**
 * The tinted pill that names a type, a tag, or a priority.
 *
 * The board card alone carried three hand-rolled copies of the same
 * `color` + `${color}20` background arithmetic, at three slightly different font
 * sizes for no reason anyone recorded. Two sizes are enough: the value's own
 * badge, and the secondary tags that sit beside it.
 */

import React from 'react';

export interface TrackerSwatchBadgeProps {
  label: string;
  /** Hex swatch; the fill and border are derived from it. */
  color: string;
  /** `secondary` is smaller and outlined, for the trailing type tags. */
  variant?: 'primary' | 'secondary';
  className?: string;
  title?: string;
}

export function TrackerSwatchBadge({
  label,
  color,
  variant = 'primary',
  className = '',
  title,
}: TrackerSwatchBadgeProps) {
  const secondary = variant === 'secondary';
  return (
    <span
      className={`tracker-swatch-badge font-medium rounded ${
        secondary ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5'
      } ${className}`}
      style={{
        color,
        backgroundColor: `${color}${secondary ? '12' : '20'}`,
        ...(secondary ? { border: `1px solid ${color}30` } : {}),
      }}
      title={title}
    >
      {label}
    </span>
  );
}
