import {
  SettingsStore,
  SettingsStorage,
  jsonEqual,
  mergeWithDefaults,
  requireReadableSettings,
} from "@utils/settings_store";

interface TestSettings {
  folder: string;
  authorTagPrefix: string;
  frontmatter: string;
  maxSearchHistory: number;
  fieldSourcePreferences: Record<string, string[]>;
  providerHistory?: unknown;
}

const createDefaults = (): TestSettings => ({
  folder: "",
  authorTagPrefix: "",
  frontmatter: "default frontmatter",
  maxSearchHistory: 10,
  fieldSourcePreferences: { title: ["primary"], author: ["primary"] },
});

/** In-memory data.json that round-trips through JSON like the real file. */
class FakeFile implements SettingsStorage {
  contents: string | null;
  writes = 0;
  failReads = false;
  writeDelays: number[] = [];

  constructor(initial?: object) {
    this.contents = initial === undefined ? null : JSON.stringify(initial);
  }

  load(): Promise<unknown> {
    if (this.failReads) return Promise.reject(new Error("EBUSY"));
    return Promise.resolve(
      this.contents === null ? null : JSON.parse(this.contents),
    );
  }

  async save(data: Record<string, unknown>): Promise<void> {
    const delay = this.writeDelays.shift() ?? 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    this.contents = JSON.stringify(data);
    this.writes += 1;
  }

  get parsed(): Record<string, unknown> {
    return JSON.parse(this.contents ?? "null") as Record<string, unknown>;
  }
}

const makeStore = (file: FakeFile) =>
  new SettingsStore<TestSettings>(file, createDefaults);

describe("jsonEqual", () => {
  it("ignores key order and compares deeply", () => {
    expect(
      jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
    ).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
  });
});

describe("requireReadableSettings", () => {
  it("passes through what Obsidian loaded, including a missing file (null)", () => {
    expect(requireReadableSettings({ folder: "Books" })).toEqual({
      folder: "Books",
    });
    expect(requireReadableSettings(null)).toBeNull();
  });

  it("turns undefined, which Obsidian returns for an unparseable file, into an error", () => {
    expect(() => requireReadableSettings(undefined)).toThrow(
      "could not be parsed",
    );
  });

  it("makes the store refuse to overwrite such a file", async () => {
    // Mirrors the plugin's storage: loadData() gives undefined for bad JSON.
    let contents: string | null = '{"folder": "Precious", "authorTagPr';
    let writes = 0;
    const storage: SettingsStorage = {
      load: () => {
        let loaded: unknown;
        try {
          loaded = contents === null ? null : JSON.parse(contents);
        } catch {
          loaded = undefined;
        }
        return Promise.resolve(requireReadableSettings(loaded));
      },
      save: (data) => {
        contents = JSON.stringify(data);
        writes += 1;
        return Promise.resolve();
      },
    };
    const store = new SettingsStore<TestSettings>(storage, createDefaults);
    const settings = await store.load();
    expect(store.loadFailed).toBe(true);

    settings.folder = "Changed";
    await expect(store.save(settings)).rejects.toThrow();
    expect(writes).toBe(0);
    expect(contents).toBe('{"folder": "Precious", "authorTagPr');
  });
});

describe("mergeWithDefaults", () => {
  it("returns a copy of the defaults when nothing is stored", () => {
    const defaults = createDefaults();
    for (const stored of [null, undefined, "junk", 42, [1, 2]]) {
      expect(mergeWithDefaults(defaults, stored)).toEqual(defaults);
    }
  });

  it("lets stored values win, merges nested maps and keeps unknown keys", () => {
    const merged = mergeWithDefaults(createDefaults(), {
      folder: "Books",
      fieldSourcePreferences: { title: ["goodreads"], isbn13: ["google"] },
      somethingFromANewerVersion: true,
    }) as TestSettings & { somethingFromANewerVersion: boolean };

    expect(merged.folder).toBe("Books");
    expect(merged.maxSearchHistory).toBe(10);
    expect(merged.fieldSourcePreferences).toEqual({
      title: ["goodreads"],
      author: ["primary"],
      isbn13: ["google"],
    });
    expect(merged.somethingFromANewerVersion).toBe(true);
  });

  it("never lets a stored null or undefined replace a default", () => {
    const merged = mergeWithDefaults(createDefaults(), {
      folder: null,
      frontmatter: undefined,
    });
    expect(merged.folder).toBe("");
    expect(merged.frontmatter).toBe("default frontmatter");
  });
});

describe("SettingsStore.load", () => {
  it("returns defaults when the file does not exist, without writing", async () => {
    const file = new FakeFile();
    const settings = await makeStore(file).load();
    expect(settings).toEqual(createDefaults());
    expect(file.writes).toBe(0);
  });

  it("returns a fresh object each time, never shared with the defaults", async () => {
    const file = new FakeFile();
    const store = makeStore(file);
    const a = await store.load();
    a.fieldSourcePreferences.title.push("mutated");
    const b = await store.load();
    expect(b.fieldSourcePreferences.title).toEqual(["primary"]);
  });

  it("falls back to defaults, flags the failure and leaves the file alone when unreadable", async () => {
    const file = new FakeFile({ folder: "Books" });
    file.failReads = true;
    const store = makeStore(file);
    const settings = await store.load();
    expect(settings).toEqual(createDefaults());
    expect(store.loadFailed).toBe(true);

    settings.folder = "Changed";
    await expect(store.save(settings)).rejects.toThrow("EBUSY");
    expect(file.writes).toBe(0);
    expect(file.parsed.folder).toBe("Books");
  });

  it("clears the failure flag once the file can be read again", async () => {
    const file = new FakeFile({ folder: "Books" });
    file.failReads = true;
    const store = makeStore(file);
    await store.load();
    file.failReads = false;
    const settings = await store.load();
    expect(store.loadFailed).toBe(false);
    expect(settings.folder).toBe("Books");
  });
});

describe("SettingsStore.save", () => {
  it("does not write when nothing changed (the periodic flush case)", async () => {
    const file = new FakeFile({ folder: "Books", authorTagPrefix: "authors/" });
    const store = makeStore(file);
    const settings = await store.load();

    expect(await store.save(settings)).toBe(false);
    expect(file.writes).toBe(0);
  });

  it("never replaces saved settings with defaults when the file was missing at start (issue 9)", async () => {
    // The plugin started before sync delivered data.json, so it holds defaults.
    const file = new FakeFile();
    const store = makeStore(file);
    const settings = await store.load();

    // Sync then delivers the user's real settings.
    file.contents = JSON.stringify({
      folder: "_SYS/DATA/Books",
      authorTagPrefix: "authors/",
      frontmatter: "my custom frontmatter",
    });

    // The periodic flush finds nothing changed and writes nothing.
    expect(await store.save(settings)).toBe(false);
    expect(file.parsed.folder).toBe("_SYS/DATA/Books");

    // Even a deliberate change to one setting keeps every other saved value.
    settings.maxSearchHistory = 25;
    expect(await store.save(settings)).toBe(true);
    expect(file.parsed).toEqual({
      folder: "_SYS/DATA/Books",
      authorTagPrefix: "authors/",
      frontmatter: "my custom frontmatter",
      maxSearchHistory: 25,
    });
  });

  it("does not write stale values back over a newer file from another device (issue 9)", async () => {
    const file = new FakeFile({ folder: "Old", authorTagPrefix: "old/" });
    const store = makeStore(file);
    const settings = await store.load();

    // Another device changes both settings and sync updates the file.
    file.contents = JSON.stringify({ folder: "New", authorTagPrefix: "new/" });

    // This device only changes the frontmatter.
    settings.frontmatter = "edited here";
    await store.save(settings);

    expect(file.parsed).toEqual({
      folder: "New",
      authorTagPrefix: "new/",
      frontmatter: "edited here",
    });
  });

  it("writes only the changed keys and keeps unknown keys already on disk", async () => {
    const file = new FakeFile({ folder: "Books", futureSetting: [1, 2, 3] });
    const store = makeStore(file);
    const settings = await store.load();
    settings.authorTagPrefix = "writers/";
    await store.save(settings);

    expect(file.parsed).toEqual({
      folder: "Books",
      futureSetting: [1, 2, 3],
      authorTagPrefix: "writers/",
    });
  });

  it("persists a setting changed back to its default", async () => {
    const file = new FakeFile({ folder: "Books" });
    const store = makeStore(file);
    const settings = await store.load();
    settings.folder = "";
    await store.save(settings);
    expect(file.parsed.folder).toBe("");
  });

  it("writes a nested change, such as a field preference, as one key", async () => {
    const file = new FakeFile({
      fieldSourcePreferences: { title: ["google"] },
    });
    const store = makeStore(file);
    const settings = await store.load();
    settings.fieldSourcePreferences.author = ["goodreads"];
    await store.save(settings);
    expect(file.parsed.fieldSourcePreferences).toEqual({
      title: ["google"],
      author: ["goodreads"],
    });
  });

  it("is idempotent: saving the same state twice writes once", async () => {
    const file = new FakeFile({ folder: "Books" });
    const store = makeStore(file);
    const settings = await store.load();
    settings.folder = "Shelf";
    expect(await store.save(settings)).toBe(true);
    expect(await store.save(settings)).toBe(false);
    expect(file.writes).toBe(1);
  });

  it("does not rewrite history that only differs by undefined fields", async () => {
    const file = new FakeFile({
      providerHistory: { goodreads: { buckets: [{ h: 1, ok: 2, fail: 0 }] } },
    });
    const store = makeStore(file);
    const settings = await store.load();
    // Live provider-history records carry explicit undefined properties that
    // vanish when written to disk.
    settings.providerHistory = {
      goodreads: {
        buckets: [{ h: 1, ok: 2, fail: 0 }],
        lastErrorAt: undefined,
      },
    };
    expect(await store.save(settings)).toBe(false);
    expect(file.writes).toBe(0);
  });

  it("serialises overlapping saves so the newest state is what ends up on disk", async () => {
    const file = new FakeFile({ folder: "A" });
    const store = makeStore(file);
    const settings = await store.load();

    // The first write is slow; the second would overtake it without the queue.
    file.writeDelays = [40, 0];
    settings.folder = "B";
    const first = store.save(settings);
    settings.folder = "C";
    const second = store.save(settings);
    await Promise.all([first, second]);

    expect(file.parsed.folder).toBe("C");
  });

  it("keeps working after a failed save", async () => {
    const file = new FakeFile({ folder: "A" });
    const store = makeStore(file);
    const settings = await store.load();

    file.failReads = true;
    settings.folder = "B";
    await expect(store.save(settings)).rejects.toThrow();

    file.failReads = false;
    await expect(store.save(settings)).resolves.toBe(true);
    expect(file.parsed.folder).toBe("B");
  });
});

describe("SettingsStore.reload", () => {
  it("adopts keys changed on disk and leaves the others alone", async () => {
    const file = new FakeFile({ folder: "Old", authorTagPrefix: "old/" });
    const store = makeStore(file);
    const settings = await store.load();

    file.contents = JSON.stringify({ folder: "New", authorTagPrefix: "old/" });
    expect(await store.reload(settings)).toEqual(["folder"]);
    expect(settings.folder).toBe("New");
    expect(settings.authorTagPrefix).toBe("old/");
  });

  it("updates the baseline: adopted keys are not rewritten and later saves keep them", async () => {
    const file = new FakeFile({ folder: "Old" });
    const store = makeStore(file);
    const settings = await store.load();

    file.contents = JSON.stringify({ folder: "New", authorTagPrefix: "n/" });
    await store.reload(settings);
    expect(await store.save(settings)).toBe(false);

    settings.maxSearchHistory = 5;
    await store.save(settings);
    expect(file.parsed).toEqual({
      folder: "New",
      authorTagPrefix: "n/",
      maxSearchHistory: 5,
    });
  });

  it("keeps an unsaved local edit when the file changed the same key", async () => {
    const file = new FakeFile({ folder: "Old" });
    const store = makeStore(file);
    const settings = await store.load();

    settings.folder = "Typed here";
    file.contents = JSON.stringify({ folder: "From sync" });
    expect(await store.reload(settings)).toEqual([]);
    expect(settings.folder).toBe("Typed here");

    await store.save(settings);
    expect(file.parsed.folder).toBe("Typed here");
  });

  it("ignores the echo of its own write and keeps newer in-memory edits", async () => {
    // If Obsidian reports the plugin's own save as an external change, the
    // user's latest keystrokes must survive the reload.
    const file = new FakeFile({ folder: "A" });
    const store = makeStore(file);
    const settings = await store.load();

    settings.folder = "AB";
    await store.save(settings);
    settings.folder = "ABC"; // typed before the echo arrives
    expect(await store.reload(settings)).toEqual([]);
    expect(settings.folder).toBe("ABC");

    await store.save(settings);
    expect(file.parsed.folder).toBe("ABC");
  });

  it("fills keys that an older file lacks with the defaults when it adopts them", async () => {
    const file = new FakeFile({});
    const store = makeStore(file);
    const settings = await store.load();

    file.contents = JSON.stringify({
      fieldSourcePreferences: { title: ["goodreads"] },
    });
    expect(await store.reload(settings)).toEqual(["fieldSourcePreferences"]);
    expect(settings.fieldSourcePreferences).toEqual({
      title: ["goodreads"],
      author: ["primary"],
    });
  });

  it("changes nothing and returns no keys when the file is unreadable", async () => {
    const file = new FakeFile({ folder: "Books", authorTagPrefix: "a/" });
    const store = makeStore(file);
    const settings = await store.load();

    file.failReads = true;
    expect(await store.reload(settings)).toEqual([]);
    file.failReads = false;

    // The baseline is intact: only the real change is written, and the saved
    // values this copy did not touch stay on disk.
    settings.maxSearchHistory = 3;
    await store.save(settings);
    expect(file.parsed).toEqual({
      folder: "Books",
      authorTagPrefix: "a/",
      maxSearchHistory: 3,
    });
  });

  it("changes nothing when the file is missing", async () => {
    const file = new FakeFile({ folder: "Books" });
    const store = makeStore(file);
    const settings = await store.load();
    file.contents = null;
    expect(await store.reload(settings)).toEqual([]);
    expect(settings.folder).toBe("Books");
  });

  it("recovers from an unreadable start: the first readable reload supplies the real settings", async () => {
    const file = new FakeFile({ folder: "Books" });
    file.failReads = true;
    const store = makeStore(file);
    const settings = await store.load();
    expect(store.loadFailed).toBe(true);

    file.failReads = false;
    expect(await store.reload(settings)).toEqual(["folder"]);
    expect(settings.folder).toBe("Books");
    expect(store.loadFailed).toBe(false);
  });
});
