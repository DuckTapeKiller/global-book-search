import {
  getProviderHealth,
  ProviderHealthStatus,
} from "@utils/provider_health";

// Single source of truth for the provider status dot used across every modal.
// Always a glowing CSS dot, never words: green = working, amber = unstable,
// red = blocked/unavailable. The status word + last error live in the tooltip.
const HEALTH_DOT: Record<ProviderHealthStatus, { cls: string; word: string }> =
  {
    ok: { cls: "bsp-health-dot--ok", word: "Working" },
    flaky: { cls: "bsp-health-dot--warn", word: "Unstable" },
    blocked: { cls: "bsp-health-dot--error", word: "Blocked" },
    down: { cls: "bsp-health-dot--error", word: "Unavailable" },
  };

export function providerHealthDot(providerId: string): {
  cls: string;
  title: string;
} {
  const h = getProviderHealth(providerId);
  const { cls, word } = HEALTH_DOT[h.status];
  const title =
    h.status !== "ok" && h.lastErrorMessage
      ? `${word} — ${h.lastErrorMessage}`
      : word;
  return { cls, title };
}

/** Append a glowing status dot for a provider to a parent element. */
export function appendHealthDot(
  parent: HTMLElement,
  providerId: string,
): HTMLElement {
  const { cls, title } = providerHealthDot(providerId);
  const dot = parent.createSpan({ cls: `bsp-health-dot ${cls}` });
  dot.setAttribute("title", title);
  return dot;
}
