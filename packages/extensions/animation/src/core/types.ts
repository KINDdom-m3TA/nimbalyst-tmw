/**
 * The `.anim.json` document model.
 *
 * The animation is a named scene plus an ordered list of steps that assign
 * states to the scene's parts. Interpolation between steps is delegated to CSS
 * transitions, so the document says *what is true when*, never *how to tween*.
 *
 * Two properties are load-bearing and every change here has to preserve them:
 *
 * - **Times are integer milliseconds.** Never frame indices, never floats.
 *   Frames belong to rendering and export, not to the document.
 * - **Ids are names an agent can read and write.** `store`, `title-card`. Not
 *   generated handles. A plain `Edit` on this file has to be as legitimate an
 *   authoring path as the editor's own drag, which is what `serialize.ts`
 *   exists to guarantee.
 */

/** Part kinds the renderer knows how to draw. */
export type PartType = 'node' | 'edge' | 'label' | 'shape';

/** Semantic colour roles, mapped to `--nim-*` tokens by the stage stylesheet. */
export type Tone =
  | 'neutral'
  | 'accent'
  | 'data'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted';

export interface StageSpec {
  width: number;
  height: number;
  fps: number;
  /** Optional background override; defaults to the stage surface token. */
  background?: string;
}

interface PartBase {
  type: PartType;
  /** Human-facing name. Falls back to the part id when absent. */
  label?: string;
  /** Baseline tone before any step overrides it. */
  tone?: Tone;
  /** Baseline state before any step overrides it. Defaults to `idle`. */
  state?: string;
}

export interface NodePart extends PartBase {
  type: 'node';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Small mono line under the title. */
  subtitle?: string;
  /** Rows rendered inside the node body, e.g. key/value pairs. */
  rows?: Array<{ key: string; value?: string }>;
}

export interface EdgePart extends PartBase {
  type: 'edge';
  /** Part ids. The renderer resolves them to node anchor points. */
  from: string;
  to: string;
  /** Caption drawn at the midpoint. */
  text?: string;
  /**
   * How many packets travel the edge while it is flowing. 0 turns them off for
   * an edge that represents a relationship rather than traffic.
   */
  packets?: number;
}

export interface LabelPart extends PartBase {
  type: 'label';
  x: number;
  y: number;
  text: string;
  align?: 'start' | 'middle' | 'end';
  /** Rendered in the small tracked-out caps style used for scene captions. */
  caps?: boolean;
}

export interface ShapePart extends PartBase {
  type: 'shape';
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: 'rect' | 'circle';
  text?: string;
}

export type Part = NodePart | EdgePart | LabelPart | ShapePart;

/** What a step asserts about one part. */
export interface PartAssignment {
  state?: string;
  tone?: Tone;
}

export interface Step {
  id: string;
  /** Milliseconds this step holds before the next one begins. */
  duration: number;
  caption?: string;
  /** Part id to the state that becomes true when this step starts. */
  set?: Record<string, PartAssignment>;
}

export interface AnimDocument {
  version: 1;
  stage: StageSpec;
  parts: Record<string, Part>;
  steps: Step[];
}

/** A part's fully-resolved appearance at a point in time. */
export interface ResolvedPartState {
  state: string;
  tone: Tone;
}

/** Where the playhead is, expressed in the document's own terms. */
export interface TimelinePosition {
  /** Milliseconds from the start of the animation. */
  time: number;
  /** Index into `steps`, or -1 when the document has no steps. */
  stepIndex: number;
  /** Milliseconds elapsed inside the current step. */
  offsetInStep: number;
}

export const DEFAULT_STATE = 'idle';
export const DEFAULT_TONE: Tone = 'neutral';

export const TONES: readonly Tone[] = [
  'neutral',
  'accent',
  'data',
  'success',
  'warning',
  'error',
  'muted',
] as const;

/** Frame rates whose frame delay is a whole number of milliseconds. */
export const SUGGESTED_FPS: readonly number[] = [10, 20, 25, 50] as const;
