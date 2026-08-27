/**
 * The stage stylesheet: where the animation actually lives.
 *
 * Playback sets `data-state` and `data-tone` on parts; every rule here is keyed
 * off those attributes, and `transition` does the interpolation. That is the
 * whole runtime. Adding a new visual state means adding a selector here, not
 * teaching a scheduler about a new property.
 *
 * Theme tokens are injected rather than inherited: the stage renders inside an
 * iframe, so the host's `--nim-*` cascade does not reach it. `ThemeTokens` is
 * read from the host document and written into `:root` here, which is also what
 * makes the eventual standalone export theme-able by find-and-replace.
 */

import { PACKET_TRAVEL_S } from "./scene";

export interface ThemeTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  purple: string;
}

export const FALLBACK_TOKENS: ThemeTokens = {
  bg: "#16181c",
  surface: "#1e2126",
  surfaceRaised: "#22262c",
  border: "#4a4a4a",
  borderStrong: "#5c5c5c",
  text: "#ffffff",
  textMuted: "#b3b3b3",
  textFaint: "#808080",
  accent: "#60a5fa",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#ef4444",
  purple: "#a78bfa",
};

/** Duration of the state-to-state transition, in milliseconds. */
export const TRANSITION_MS = 320;

/**
 * Keep document/theme values inside a CSS declaration and the surrounding
 * `<style>` raw-text element. CSS colors may contain functions and spaces, but
 * never need declaration/selector delimiters, markup, imports, or URLs.
 */
export function safeCssColor(
  value: string | undefined,
  fallback: string
): string {
  const candidate = value?.trim() ?? "";
  if (
    candidate === "" ||
    candidate.length > 256 ||
    /[<>{};@\\]/.test(candidate) ||
    /url\s*\(/i.test(candidate)
  ) {
    return fallback;
  }
  return candidate;
}

export function buildStageCss(
  tokens: ThemeTokens,
  background?: string
): string {
  const safeTokens = Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [
      key,
      safeCssColor(value, FALLBACK_TOKENS[key as keyof ThemeTokens]),
    ])
  ) as unknown as ThemeTokens;
  const safeBackground = safeCssColor(background, safeTokens.bg);

  return `
:root {
  --anim-bg: ${safeBackground};
  --anim-surface: ${safeTokens.surface};
  --anim-surface-raised: ${safeTokens.surfaceRaised};
  --anim-border: ${safeTokens.border};
  --anim-border-strong: ${safeTokens.borderStrong};
  --anim-text: ${safeTokens.text};
  --anim-text-muted: ${safeTokens.textMuted};
  --anim-text-faint: ${safeTokens.textFaint};

  --anim-tone-neutral: ${safeTokens.textFaint};
  --anim-tone-accent: ${safeTokens.accent};
  --anim-tone-data: ${safeTokens.purple};
  --anim-tone-success: ${safeTokens.success};
  --anim-tone-warning: ${safeTokens.warning};
  --anim-tone-error: ${safeTokens.error};
  --anim-tone-muted: ${safeTokens.textFaint};

  --anim-mono: ui-monospace, 'SF Mono', Monaco, 'Courier New', monospace;
  --anim-duration: ${TRANSITION_MS}ms;
  --anim-ease: cubic-bezier(0.4, 0, 0.2, 1);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  background: var(--anim-bg);
  overflow: hidden;
}

.anim-stage {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--anim-bg);
  user-select: none;
}

/* ---- tone resolution ---------------------------------------------------- */
.anim-part { --anim-tone: var(--anim-tone-neutral); }
.anim-part[data-tone="accent"]  { --anim-tone: var(--anim-tone-accent); }
.anim-part[data-tone="data"]    { --anim-tone: var(--anim-tone-data); }
.anim-part[data-tone="success"] { --anim-tone: var(--anim-tone-success); }
.anim-part[data-tone="warning"] { --anim-tone: var(--anim-tone-warning); }
.anim-part[data-tone="error"]   { --anim-tone: var(--anim-tone-error); }
.anim-part[data-tone="muted"]   { --anim-tone: var(--anim-tone-muted); }

.anim-part {
  --anim-tone-fill: color-mix(in srgb, var(--anim-tone) 14%, transparent);
}

/* ---- nodes -------------------------------------------------------------- */
.anim-node-body {
  fill: var(--anim-surface);
  stroke: var(--anim-border);
  stroke-width: 1.3px;
  transition: fill var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease),
              stroke-width var(--anim-duration) var(--anim-ease);
}
.anim-node-header { fill: var(--anim-surface-raised); }
.anim-node-rule { stroke: var(--anim-border); stroke-width: 1.2px; }
.anim-node-title {
  fill: var(--anim-text);
  font-family: var(--anim-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.8px;
  transition: fill var(--anim-duration) var(--anim-ease);
}
.anim-node-subtitle,
.anim-row-key,
.anim-row-value {
  font-family: var(--anim-mono);
  font-size: 11px;
  transition: fill var(--anim-duration) var(--anim-ease);
}
.anim-node-subtitle { fill: var(--anim-text-faint); }
.anim-row-key { fill: var(--anim-text-muted); }
.anim-row-value { fill: var(--anim-text-faint); }
.anim-row-box {
  fill: var(--anim-surface-raised);
  stroke: var(--anim-border);
  stroke-width: 1.1px;
  transition: fill var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease);
}
.anim-node-dot {
  fill: var(--anim-tone);
  opacity: 0;
  transition: opacity var(--anim-duration) var(--anim-ease),
              fill var(--anim-duration) var(--anim-ease);
}

/* Node states */
.anim-node[data-state="active"] .anim-node-body {
  fill: color-mix(in srgb, var(--anim-tone) 10%, var(--anim-surface));
  stroke: var(--anim-tone);
  stroke-width: 1.8px;
}
.anim-node[data-state="active"] .anim-node-dot { opacity: 1; }
.anim-node[data-state="active"] .anim-row-box:first-of-type {
  fill: var(--anim-tone-fill);
  stroke: var(--anim-tone);
}
.anim-node[data-state="offline"] .anim-node-body {
  fill: color-mix(in srgb, var(--anim-tone-error) 9%, var(--anim-surface));
  stroke: var(--anim-tone-error);
  stroke-dasharray: 4 3;
}
.anim-node[data-state="offline"] .anim-node-title { fill: var(--anim-text-faint); }
.anim-node[data-state="waiting"] .anim-node-body {
  stroke: var(--anim-tone-warning);
  stroke-dasharray: 5 4;
}
.anim-node[data-state="hidden"] { opacity: 0; }
.anim-node { transition: opacity var(--anim-duration) var(--anim-ease); }

/* ---- edges -------------------------------------------------------------- */
.anim-edge-line {
  fill: none;
  stroke: var(--anim-border);
  stroke-width: 1.4px;
  stroke-dasharray: 5 4;
}
.anim-edge-flow {
  fill: none;
  stroke: var(--anim-tone);
  stroke-width: 1.7px;
  /* Drawn on top of the dashed baseline and revealed by dash offset, so a
     "flowing" edge reads as the line filling in rather than blinking on. The
     path carries pathLength="1", so these are fractions of the edge, not px. */
  stroke-dasharray: 1 1;
  stroke-dashoffset: 1;
  opacity: 0;
  transition: opacity var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease);
}

/* ---- edge packets ------------------------------------------------------- */
.anim-edge-packet {
  fill: var(--anim-tone);
  stroke: var(--anim-bg);
  stroke-width: 1px;
  opacity: 0;
  offset-rotate: 0deg;
  offset-distance: 0%;
  transition: fill var(--anim-duration) var(--anim-ease);
}

.anim-edge[data-state="flowing"] .anim-edge-packet,
.anim-edge[data-state="active"] .anim-edge-packet {
  animation: anim-packet-travel ${PACKET_TRAVEL_S}s linear infinite;
}

/*
 * A reply travels the same wire the other way. Reversing the packets rather
 * than drawing a second edge keeps the two nodes joined by one line -- two
 * overlapping edges between the same pair read as a rendering fault.
 */
.anim-edge[data-state="returning"] .anim-edge-packet {
  animation: anim-packet-travel ${PACKET_TRAVEL_S}s linear infinite reverse;
}

/*
 * Fading in and out at the ends stops a packet from appearing to burst out of
 * the source node and vanish into the target one; it enters and leaves the
 * wire instead.
 */
@keyframes anim-packet-travel {
  0%   { offset-distance: 0%;   opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
.anim-edge-arrow path {
  fill: none;
  stroke: var(--anim-border);
  stroke-width: 1.6px;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke var(--anim-duration) var(--anim-ease);
}
.anim-edge-label rect {
  fill: var(--anim-bg);
  stroke: none;
}
.anim-edge-label text {
  fill: var(--anim-text-faint);
  font-family: var(--anim-mono);
  font-size: 12.5px;
  transition: fill var(--anim-duration) var(--anim-ease);
}

.anim-edge[data-state="flowing"] .anim-edge-flow,
.anim-edge[data-state="returning"] .anim-edge-flow,
.anim-edge[data-state="active"] .anim-edge-flow {
  opacity: 1;
  stroke-dashoffset: 0;
  transition: opacity var(--anim-duration) var(--anim-ease),
              stroke-dashoffset var(--anim-duration) var(--anim-ease);
}
.anim-edge[data-state="flowing"] .anim-edge-arrow path,
.anim-edge[data-state="returning"] .anim-edge-arrow path,
.anim-edge[data-state="active"] .anim-edge-arrow path { stroke: var(--anim-tone); }
.anim-edge[data-state="flowing"] .anim-edge-label text,
.anim-edge[data-state="returning"] .anim-edge-label text,
.anim-edge[data-state="active"] .anim-edge-label text { fill: var(--anim-tone); }
.anim-edge[data-state="hidden"] { opacity: 0; }
.anim-edge { transition: opacity var(--anim-duration) var(--anim-ease); }

/* ---- labels and shapes -------------------------------------------------- */
.anim-label {
  fill: var(--anim-text-muted);
  font-family: var(--anim-mono);
  font-size: 12px;
  transition: fill var(--anim-duration) var(--anim-ease),
              opacity var(--anim-duration) var(--anim-ease);
}
.anim-label-caps {
  fill: var(--anim-text-faint);
  letter-spacing: 1.4px;
}
.anim-label[data-state="active"] { fill: var(--anim-tone); }
.anim-label[data-state="hidden"] { opacity: 0; }

.anim-shape-body {
  fill: var(--anim-tone-fill);
  stroke: var(--anim-tone);
  stroke-width: 1.3px;
  transition: fill var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease),
              opacity var(--anim-duration) var(--anim-ease);
}
.anim-shape-text {
  fill: var(--anim-text);
  font-family: var(--anim-mono);
  font-size: 11px;
}
.anim-shape[data-state="active"] .anim-shape-body {
  fill: color-mix(in srgb, var(--anim-tone) 65%, transparent);
}
.anim-shape[data-state="hidden"] { opacity: 0; }
.anim-shape { transition: opacity var(--anim-duration) var(--anim-ease); }

/* ---- selection ---------------------------------------------------------- */
.anim-part.anim-selected .anim-node-body,
.anim-part.anim-selected .anim-shape-body {
  stroke: var(--anim-tone-accent);
  stroke-width: 1.8px;
}
.anim-selection-ring {
  fill: none;
  stroke: var(--anim-tone-accent);
  stroke-width: 1.4px;
  stroke-dasharray: 3 3;
  pointer-events: none;
}

.anim-hit { fill: transparent; cursor: pointer; }

/*
 * Scrubbing must land on the destination immediately, not tween toward it --
 * dragging the playhead through five steps should not queue five animations.
 * The scheduler adds this class for the duration of a seek.
 */
.anim-no-transition, .anim-no-transition * {
  transition: none !important;
}

.anim-no-animation .anim-edge-packet {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .anim-part, .anim-part * {
    transition-duration: 1ms !important;
  }
  /*
   * Packets are the one continuously-moving thing here, so reduced motion has
   * to stop them outright rather than just shorten a transition. The edge still
   * reads as active via its stroke; it just stops carrying traffic.
   */
  .anim-edge-packet {
    animation: none !important;
    opacity: 0 !important;
  }
}
`;
}
