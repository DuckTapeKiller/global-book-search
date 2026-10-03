import { App } from "obsidian";
import type { BookSearchPluginSettings } from "@settings/settings";
import { migrateToSecret, resolveProviderSecrets } from "./secrets";

function settingsWith(
  keys: Partial<BookSearchPluginSettings>,
): BookSearchPluginSettings {
  return {
    apiKey: "",
    hardcoverApiToken: "",
    librarythingApiKey: "",
    ...keys,
  } as BookSearchPluginSettings;
}

function appWithSecrets(secrets: Record<string, string>): App {
  return {
    secretStorage: { getSecret: (name: string) => secrets[name] ?? null },
  } as unknown as App;
}

describe("resolveProviderSecrets", () => {
  it("resolves the Google Books key from SecretStorage", async () => {
    const app = appWithSecrets({ "google-books": "AIza-real-value" });
    const settings = settingsWith({ apiKey: "google-books" });

    const resolved = await resolveProviderSecrets(app, settings);

    expect(resolved.apiKey).toBe("AIza-real-value");
  });

  it("keeps a plain-text Google Books key working", async () => {
    const app = appWithSecrets({});
    const settings = settingsWith({ apiKey: "AIza-plain-value" });

    const resolved = await resolveProviderSecrets(app, settings);

    expect(resolved.apiKey).toBe("AIza-plain-value");
  });

  it("resolves the Hardcover and LibraryThing keys as before", async () => {
    const app = appWithSecrets({ hc: "hc-value", lt: "lt-value" });
    const settings = settingsWith({
      hardcoverApiToken: "hc",
      librarythingApiKey: "lt",
    });

    const resolved = await resolveProviderSecrets(app, settings);

    expect(resolved.hardcoverApiToken).toBe("hc-value");
    expect(resolved.librarythingApiKey).toBe("lt-value");
  });
});

function writableApp(secrets: Record<string, string>): App {
  return {
    secretStorage: {
      getSecret: (name: string) => secrets[name] ?? null,
      setSecret: (name: string, value: string) => {
        secrets[name] = value;
      },
    },
  } as unknown as App;
}

describe("migrateToSecret", () => {
  it("moves a plain-text key into SecretStorage and returns its name", async () => {
    const secrets: Record<string, string> = {};

    const stored = await migrateToSecret(
      writableApp(secrets),
      "AIza-plain-value",
      "google-books-api-key",
    );

    expect(stored).toBe("google-books-api-key");
    expect(secrets["google-books-api-key"]).toBe("AIza-plain-value");
  });

  it("leaves a value that already names a secret untouched", async () => {
    const secrets = { "my-google-key": "AIza-real-value" };

    const stored = await migrateToSecret(
      writableApp(secrets),
      "my-google-key",
      "google-books-api-key",
    );

    expect(stored).toBe("my-google-key");
    expect(secrets).toEqual({ "my-google-key": "AIza-real-value" });
  });

  it("does not overwrite a different secret under the target name", async () => {
    const secrets = { "google-books-api-key": "AIza-other-value" };

    const stored = await migrateToSecret(
      writableApp(secrets),
      "AIza-plain-value",
      "google-books-api-key",
    );

    expect(stored).toBe("AIza-plain-value");
    expect(secrets["google-books-api-key"]).toBe("AIza-other-value");
  });

  it("still migrates when looking up an invalid secret name throws", async () => {
    const secrets: Record<string, string> = {};
    const app = {
      secretStorage: {
        getSecret: (name: string) => {
          if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid ID");
          return secrets[name] ?? null;
        },
        setSecret: (name: string, value: string) => {
          secrets[name] = value;
        },
      },
    } as unknown as App;

    const stored = await migrateToSecret(
      app,
      "AIza-Plain-Value",
      "google-books-api-key",
    );

    expect(stored).toBe("google-books-api-key");
    expect(secrets["google-books-api-key"]).toBe("AIza-Plain-Value");
  });

  it("leaves an empty key empty", async () => {
    const secrets: Record<string, string> = {};

    expect(
      await migrateToSecret(writableApp(secrets), "", "google-books-api-key"),
    ).toBe("");
    expect(secrets).toEqual({});
  });

  it("keeps the plain value when SecretStorage is unavailable", async () => {
    const app = {} as unknown as App;

    expect(
      await migrateToSecret(app, "AIza-plain-value", "google-books-api-key"),
    ).toBe("AIza-plain-value");
  });
});
