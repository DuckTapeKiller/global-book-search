import { App } from "obsidian";
import type { BookSearchPluginSettings } from "@settings/settings";

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

// Returns a settings copy with every API-key field resolved to its actual
// value, so providers receive usable keys whether a field holds a secret name
// or a plain value.
export async function resolveProviderSecrets(
  app: App,
  settings: BookSearchPluginSettings,
): Promise<BookSearchPluginSettings> {
  const [apiKey, hardcoverApiToken, librarythingApiKey] = await Promise.all([
    resolveSecret(app, settings.apiKey),
    resolveSecret(app, settings.hardcoverApiToken),
    resolveSecret(app, settings.librarythingApiKey),
  ]);
  return { ...settings, apiKey, hardcoverApiToken, librarythingApiKey };
}

// Moves a key that is still stored as a plain value into SecretStorage under
// `secretName` and returns the name to store in settings instead. Returns the
// value unchanged when it is empty, already names a secret, SecretStorage is
// unavailable, or a different secret already uses `secretName`.
export async function migrateToSecret(
  app: App,
  stored: string,
  secretName: string,
): Promise<string> {
  const value = (stored || "").trim();
  const store = app.secretStorage;
  if (!value || !store || typeof store.setSecret !== "function") return stored;
  try {
    if (await store.getSecret(value)) return stored;
  } catch {
    // Not a valid secret name, so it is a plain value: migrate it.
  }
  try {
    const existing = await store.getSecret(secretName);
    if (existing && existing !== value) return stored;
    await store.setSecret(secretName, value);
    return secretName;
  } catch {
    return stored;
  }
}
