/**
 * The pick-one question, rendered as preview cards.
 *
 * This is the one place the respond surface departs from the compose surface's
 * option rows, and the departure is structural rather than cosmetic. Compose
 * renders `WidgetOptionList` + `WidgetOptionRow`: a single column of horizontal
 * rows, indicator then label then description, sized to be skimmed. Here the
 * options are a grid of vertical cards -- a preview panel on top, the choice
 * beneath it -- and selection is carried by the card frame rather than by the
 * indicator alone.
 *
 * The reason is that "which of these three do you like" is a visual question. A
 * radio list answers it badly: it makes three designs look like three strings,
 * and it makes the option you can read fastest win.
 *
 * The preview panel is a seam, not a picture. The protocol's `singleSelect`
 * option carries id, label and description and nothing else, so there is no
 * artifact here to render honestly. A caller that has one -- a subject shared
 * alongside the request, a rendered thumbnail -- supplies `renderPreview`, and
 * without one the panel stays a neutral placeholder rather than inventing an
 * image the option never had.
 */
import React from 'react';
import type { StructuredInputSingleSelectOption } from '@nimbalyst/collab-protocol';
export type FeedbackOptionPreviewRenderer = (option: StructuredInputSingleSelectOption, index: number) => React.ReactNode;
export interface FeedbackRespondOptionCardsProps {
    askId: string;
    options: readonly StructuredInputSingleSelectOption[];
    selectedId?: string;
    onSelect: (optionId: string) => void;
    disabled?: boolean;
    renderPreview?: FeedbackOptionPreviewRenderer;
    /** Shown as an expand affordance on each preview when a caller can open one. */
    onExpand?: (option: StructuredInputSingleSelectOption) => void;
}
export declare const FeedbackRespondOptionCards: React.FC<FeedbackRespondOptionCardsProps>;
