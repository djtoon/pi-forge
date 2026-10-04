export type AIStateName =
  | 'idle' | 'listening' | 'thinking' | 'searching' | 'working'
  | 'generating' | 'speaking' | 'done' | 'error' | 'paused';

export interface AIStateOptions {
  /** Initial state. Default 'idle'. */
  state?: AIStateName;
  /** 'outline' (default) or 'filled'. */
  variant?: 'outline' | 'filled';
  /** Pixel size (or any CSS length). Default 24. */
  size?: number | string;
  /** Paint with the pack's violet → cyan AI gradient instead of currentColor. */
  gradient?: boolean;
  /** Keep a subtle idle animation running in each state. Default true (false when prefers-reduced-motion). */
  live?: boolean;
  /** Morph duration in ms. Default 450. */
  duration?: number;
  /** Accessible label. Default "AI <state>". */
  label?: string;
}

export interface AIStateInstance {
  readonly svg: SVGSVGElement;
  readonly state: AIStateName;
  /** Morph to another state. */
  set(state: AIStateName): void;
  /** Change options (and optionally the state) on the fly. */
  configure(options: AIStateOptions): void;
  /** Stop animating and remove the SVG. */
  destroy(): void;
}

export const STATE_NAMES: AIStateName[];
export const STATE_LABELS: Record<AIStateName, string>;
export function createAIState(host: Element, options?: AIStateOptions): AIStateInstance;
export function stateSvg(state: AIStateName, variant?: 'outline' | 'filled'): string;
export function stateMarkup(state: AIStateName): string;
export function morphMarkup(from: AIStateName, to: AIStateName, progress: number): string;
export function defineAIStateElement(tag?: string): void;

declare global {
  interface HTMLElementTagNameMap { 'ai-state': HTMLElement & { state: AIStateName } }
}
