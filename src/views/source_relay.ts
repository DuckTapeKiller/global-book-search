import type { SourceOutcome } from "@apis/global_search";

const OUTCOME_CLASS: Record<SourceOutcome, string> = {
  found: "bsp-health-dot--ok",
  empty: "bsp-health-dot--none",
  failed: "bsp-health-dot--error",
};

const OUTCOME_TITLE: Record<SourceOutcome, string> = {
  found: "Found books",
  empty: "No books found",
  failed: "No answer",
};

const STATUS_CLASSES = [
  "bsp-health-dot--ok",
  "bsp-health-dot--warn",
  "bsp-health-dot--error",
  "bsp-health-dot--none",
];

/**
 * The source dots of a search window, as a relay: while a search runs they
 * pulse one after another in the theme's accent, and each settles on its
 * source's answer (green found, grey nothing, red failed). Nothing is drawn
 * on the window's edges, so it suits square and round corners alike.
 */
export class SourceRelay {
  private readonly dots = new Map<string, HTMLElement>();

  /** Register a source's status dot; dots pulse in the order they are added. */
  add(providerId: string, dot: HTMLElement): void {
    dot.setCssProps({ "--bsp-relay-index": String(this.dots.size) });
    this.dots.set(providerId, dot);
  }

  /** A search started: every dot pulses until its source answers. */
  start(): void {
    for (const dot of this.dots.values()) {
      dot.removeClass("is-settled");
      dot.addClass("is-pending");
    }
  }

  /** One source answered; its dot stops and shows how. */
  settle(providerId: string, outcome: SourceOutcome, reason?: string): void {
    const dot = this.dots.get(providerId);
    if (!dot) return;
    dot.removeClass("is-pending", ...STATUS_CLASSES);
    dot.addClass(OUTCOME_CLASS[outcome], "is-settled");
    dot.setAttribute("title", reason ?? OUTCOME_TITLE[outcome]);
  }

  /** The search ended; a source that never answered keeps its last colour. */
  stop(): void {
    for (const dot of this.dots.values()) dot.removeClass("is-pending");
  }
}
