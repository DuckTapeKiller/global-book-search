import { App } from "obsidian";

// API keys are stored with Obsidian's SecretStorage when available — in that
// case the plugin setting holds the secret's NAME, not its value. resolveSecret
// turns whatever is stored into the usable value, and if SecretStorage isn't
// available (older Obsidian) or the stored string isn't a known secret name, it
// falls back to treating the stored string AS the value. That keeps existing
// plaintext entries working and avoids breaking already-configured tokens.
export async function resolveSecret(app: App, stored: string): Promise<string> {
  const ref = (stored || "").trim();
  if (!ref) return "";
  const store = app.secretStorage;
  if (store && typeof store.getSecret === "function") {
    try {
      const value = await store.getSecret(ref);
      if (value) return value.trim();
    } catch {
      // fall through to treating `ref` as the raw value
    }
  }
  return ref;
}
