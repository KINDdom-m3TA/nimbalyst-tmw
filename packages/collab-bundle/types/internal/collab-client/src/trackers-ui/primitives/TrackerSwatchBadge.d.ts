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
export declare function TrackerSwatchBadge({ label, color, variant, className, title, }: TrackerSwatchBadgeProps): React.JSX.Element;
