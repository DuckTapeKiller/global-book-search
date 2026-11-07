import { App, requireApiVersion } from "obsidian";

// API keys are stored with Obsidian's SecretStorage when available (1.11.4 and
// later): the plugin setting then holds the secret's NAME, not its value.
// resolveSecret turns whatever is stored into the usable value, and when
// SecretStorage is missing or the stored string is not a known secret name, it
// treats the stored string AS the value. That keeps existing plaintext entries
// and already-configured tokens working.
export async function resolveSecret(app: App, stored: string): Promise<string> {
  const ref = (stored || "").trim();
  if (!ref) return "";
  if (requireApiVersion("1.11.4")) {
    try {
      const value = app.secretStorage.getSecret(ref);
      if (value) return value.trim();
    } catch {
      // fall through to treating `ref` as the raw value
    }
  }
  return ref;
}
