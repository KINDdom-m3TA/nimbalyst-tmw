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

export type FeedbackOptionPreviewRenderer = (
  option: StructuredInputSingleSelectOption,
  index: number,
) => React.ReactNode;

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

const OptionRadio: React.FC<{ selected: boolean }> = ({ selected }) => (
  <span
    className={
      selected
        ? 'w-[15px] h-[15px] mt-0.5 shrink-0 rounded-full border border-nim-primary bg-nim-primary flex items-center justify-center'
        : 'w-[15px] h-[15px] mt-0.5 shrink-0 rounded-full border border-nim-faint bg-nim flex items-center justify-center'
    }
  >
    {selected && <span className="w-[5px] h-[5px] rounded-full bg-nim-on-primary" />}
  </span>
);

const PlaceholderPreview: React.FC<{ label: string }> = ({ label }) => (
  <div
    aria-hidden="true"
    className="feedback-respond-option-placeholder flex h-full w-full items-center justify-center rounded bg-nim-tertiary text-lg font-semibold text-nim-faint"
  >
    {label.trim().charAt(0).toUpperCase() || '?'}
  </div>
);

export const FeedbackRespondOptionCards: React.FC<FeedbackRespondOptionCardsProps> = ({
  askId,
  options,
  selectedId,
  onSelect,
  disabled = false,
  renderPreview,
  onExpand,
}) => (
  <div
    data-testid="feedback-respond-option-cards"
    className="feedback-respond-option-cards grid grid-cols-3 gap-2.5 @[max-560px]/feedback-respond:grid-cols-2 @[max-380px]/feedback-respond:grid-cols-1"
  >
    {options.map((option, index) => {
      const selected = option.id === selectedId;
      return (
        <div
          key={option.id}
          data-testid="feedback-respond-option-card"
          data-ask-id={askId}
          data-option-id={option.id}
          data-selected={selected || undefined}
          className={
            selected
              ? 'feedback-respond-option-card relative overflow-hidden rounded-md border border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))] shadow-[0_0_0_1px_var(--nim-primary)]'
              : 'feedback-respond-option-card relative overflow-hidden rounded-md border border-nim bg-nim-secondary'
          }
        >
          <div className="feedback-respond-option-preview relative h-32 border-b border-nim bg-nim p-2.5">
            {renderPreview
              ? renderPreview(option, index)
              : <PlaceholderPreview label={option.label} />}
            {onExpand && (
              <button
                type="button"
                data-testid="feedback-respond-option-expand"
                aria-label={`Open ${option.label}`}
                onClick={() => onExpand(option)}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border border-nim bg-nim-secondary text-nim-muted cursor-pointer hover:text-nim"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M6 1h3v3M4 9H1V6M9 1 5.6 4.4M1 9l3.4-3.4"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            data-testid="feedback-respond-option-choose"
            onClick={() => onSelect(option.id)}
            disabled={disabled}
            aria-pressed={selected}
            className="flex w-full items-start gap-2 bg-transparent border-none px-2.5 py-2.5 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-nim-hover"
          >
            <OptionRadio selected={selected} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-semibold leading-snug text-nim select-text">
                {option.label}
              </span>
              {option.description && (
                <span className="text-[0.6875rem] leading-snug text-nim-muted select-text">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        </div>
      );
    })}
  </div>
);
