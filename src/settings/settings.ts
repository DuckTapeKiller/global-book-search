import { replaceDateInString } from "@utils/utils";
import {
  App,
  Menu,
  Notice,
  PluginSettingTab,
  requireApiVersion,
  SecretComponent,
  Setting,
  setIcon,
  type IconName,
  type SettingDefinitionItem,
  type SettingDefinitionRender,
  type SettingGroup,
} from "obsidian";
import { GLOBAL_SEARCH_SOURCE_LABELS, ServiceProvider } from "@src/constants";
import languages from "@utils/languages";
import BookSearchPlugin from "../main";
import { FileNameFormatSuggest } from "./suggesters/FileNameFormatSuggester";
import { FileSuggest } from "./suggesters/FileSuggester";
import { FolderSuggest } from "./suggesters/FolderSuggester";
import { clearHttpCache } from "@utils/http";
import {
  getProviderHealth,
  ProviderHealthStatus,
  resetProviderHealth,
} from "@utils/provider_health";
import {
  clearHistory,
  FAILURE_REASON_LABELS,
  FAILURE_REASONS,
  getTrackedProviderIds,
  summarizeProvider,
} from "@utils/provider_history";

const docUrl = "https://github.com/DuckTapeKiller/global-book-search";

export enum DefaultFrontmatterKeyType {
  snakeCase = "Snake Case",
  camelCase = "Camel Case",
}

export interface BookSearchPluginSettings {
  folder: string; // new file location
  fileNameFormat: string; // new file name format
  frontmatter: string; // frontmatter that is inserted into the file
  content: string; // what is automatically written to the file.
  useDefaultFrontmatter: boolean;
  defaultFrontmatterKeyType: DefaultFrontmatterKeyType;
  templateFile: string;
  serviceProvider: ServiceProvider;
  localePreference: string;
  apiKey: string;
  hardcoverApiToken: string; // Hardcover personal API token (Account → API)
  librarythingApiKey: string; // LibraryThing API token (Talpa Search API)
  // StoryGraph login: the user's own browser cookies (secret names when
  // SecretStorage holds them). StoryGraph answers only signed-in requests.
  storygraphSessionCookie: string; // _storygraph_session
  storygraphRememberToken: string; // remember_user_token
  openPageOnCompletion: boolean;
  showCoverImageInSearch: boolean;
  enableCoverImageEdgeCurl: boolean;
  coverImagePath: string;
  askForLocale: boolean;
  calibreServerUrl: string;
  calibreLibraryId: string;

  // New features
  warnOnDuplicate: boolean; // Warn if book note already exists
  searchHistory: string[]; // Last 10 searches
  maxSearchHistory: number; // How many to keep
  enableSeriesLinking: boolean; // Add series links automatically
  showTemplatePreview: boolean; // Unused: no preview exists; kept so saved settings load unchanged
  showIndividualServiceButtons: boolean; // Show all providers in selection modal
  authorTagPrefix: string;
  titleTagPrefix: string;

  // Diagnostics / networking
  diagnosticsEnabled: boolean;
  httpCacheEnabled: boolean;
  httpCacheTtlMinutes: number;
  httpRateLimitMs: number;
  httpMaxRetries: number;
  httpRetryBaseDelayMs: number;

  // Merge behavior
  fieldSourcePreferences: Record<string, string[]>;

  // Cover behavior
  coverImageMode: "local" | "remote" | "none";
  coverImageFileExtension: "jpg" | "png" | "webp";

  // Persisted rolling provider performance history (last few days). Opaque
  // snapshot owned by @utils/provider_history; not user-editable.
  providerHistory?: unknown;
}

export const FRONTMATTER_TEMPLATES = {
  Spanish: `---
Título: {{title}}
Título original: {{originalTitle}}
Autor: {{author}}
Traductor: {{translator}}
Prólogo: ""
Resumen: "{{description}}"
Páginas: "{{totalPage}}"
Editorial: {{publisher}}
Géneros: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
ASIN: {{asin}}
Fecha de publicación: {{publishDate}}
Fecha de lectura: 
Portada: "{{localCoverImage}}"
Enlace: {{link}}
tags: {{tags}}
Leído: false
---`,
  English: `---
Title: {{title}}
Original title: {{originalTitle}}
Author: {{author}}
Translator: {{translator}}
Prologue: ""
Description: "{{description}}"
Total Pages: "{{totalPage}}"
Publisher: {{publisher}}
Categories: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Published: {{publishDate}}
Date read:
Cover: "{{localCoverImage}}"
Link: {{link}}
Tags: {{tags}}
Read: false
---`,
  French: `---
Titre: {{title}}
Titre original: {{originalTitle}}
Auteur: {{author}}
Traducteur: {{translator}}
Prologue: ""
Description: "{{description}}"
Nombre total de pages: "{{totalPage}}"
Éditeur: {{publisher}}
Catégories: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Publié: {{publishDate}}
Date de lecture: 
Couverture: "{{localCoverImage}}"
Lien: {{link}}
tags: {{tags}}
Lu: false
---`,
  German: `---
Titel: {{title}}
Originaltitel: {{originalTitle}}
Autor: {{author}}
Übersetzer: {{translator}}
Prolog: ""
Beschreibung: "{{description}}"
Gesamtseitenzahl: "{{totalPage}}"
Verlag: {{publisher}}
Kategorien: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Veröffentlicht: {{publishDate}}
Lesedatum: 
Cover: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Gelesen: false
---`,
  Italian: `---
Titolo: {{title}}
Titolo originale: {{originalTitle}}
Autore: {{author}}
Traduttore: {{translator}}
Prologo: ""
Descrizione: "{{description}}"
Pagine totali: "{{totalPage}}"
Editore: {{publisher}}
Categorie: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Pubblicato: {{publishDate}}
Data di lettura: 
Copertina: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Letto: false
---`,
  Portuguese: `---
Título: {{title}}
Título original: {{originalTitle}}
Autor: {{author}}
Tradutor: {{translator}}
Prólogo: ""
Descrição: "{{description}}"
Total de páginas: "{{totalPage}}"
Editora: {{publisher}}
Categorias: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Publicado: {{publishDate}}
Data de leitura: 
Capa: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Lido: false
---`,
  Dutch: `---
Titel: {{title}}
Oorspronkelijke titel: {{originalTitle}}
Auteur: {{author}}
Vertaler: {{translator}}
Proloog: ""
Beschrijving: "{{description}}"
Totaal aantal pagina's: "{{totalPage}}"
Uitgever: {{publisher}}
Categorieën: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Gepubliceerd: {{publishDate}}
Gelezen op: 
Omslag: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Gelezen: false
---`,
  Russian: `---
Название: {{title}}
Оригинальное название: {{originalTitle}}
Автор: {{author}}
Переводчик: {{translator}}
Пролог: ""
Описание: "{{description}}"
Всего страниц: "{{totalPage}}"
Издатель: {{publisher}}
Категории: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Опубликовано: {{publishDate}}
Дата прочтения: 
Обложка: "{{localCoverImage}}"
Ссылка: {{link}}
tags: {{tags}}
Прочитано: false
---`,
  "Simplified Chinese": `---
标题: {{title}}
原标题: {{originalTitle}}
作者: {{author}}
译者: {{translator}}
序言: ""
描述: "{{description}}"
总页数: "{{totalPage}}"
出版社: {{publisher}}
分类: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
出版日期: {{publishDate}}
阅读日期: 
封面: "{{localCoverImage}}"
链接: {{link}}
tags: {{tags}}
已读: false
---`,
  Japanese: `---
タイトル: {{title}}
原題: {{originalTitle}}
著者: {{author}}
翻訳者: {{translator}}
プロローグ: ""
説明: "{{description}}"
総ページ数: "{{totalPage}}"
出版社: {{publisher}}
カテゴリ: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
出版日: {{publishDate}}
読了日: 
表紙: "{{localCoverImage}}"
リンク: {{link}}
tags: {{tags}}
読了: false
---`,
  Korean: `---
제목: {{title}}
원제: {{originalTitle}}
저자: {{author}}
번역가: {{translator}}
프롤로그: ""
설명: "{{description}}"
총 페이지 수: "{{totalPage}}"
출판사: "{{publisher}}"
카테고리: "{{categories}}"
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: "{{asin}}"
출판일: "{{publishDate}}"
읽은 날짜: 
표지: "{{localCoverImage}}"
링크: "{{link}}"
tags: {{tags}}
읽음: false
---`,
};

export const DEFAULT_SETTINGS: BookSearchPluginSettings = {
  folder: "",
  fileNameFormat: "{{title}} - {{author}}",
  frontmatter: FRONTMATTER_TEMPLATES.Spanish,
  content: "",
  useDefaultFrontmatter: false,
  defaultFrontmatterKeyType: DefaultFrontmatterKeyType.camelCase,
  templateFile: "",
  serviceProvider: ServiceProvider.google,
  localePreference: "default",
  apiKey: "",
  hardcoverApiToken: "",
  librarythingApiKey: "",
  storygraphSessionCookie: "",
  storygraphRememberToken: "",
  openPageOnCompletion: true,
  showCoverImageInSearch: true,
  enableCoverImageEdgeCurl: true,
  coverImagePath: "",
  askForLocale: true,
  calibreServerUrl: "http://localhost:8080",
  calibreLibraryId: "calibre",

  // New features defaults
  warnOnDuplicate: true,
  searchHistory: [],
  maxSearchHistory: 10,
  enableSeriesLinking: true,
  showTemplatePreview: false,
  showIndividualServiceButtons: false,
  authorTagPrefix: "",
  titleTagPrefix: "",

  // Diagnostics / networking
  diagnosticsEnabled: false,
  httpCacheEnabled: true,
  httpCacheTtlMinutes: 10,
  httpRateLimitMs: 400,
  httpMaxRetries: 2,
  httpRetryBaseDelayMs: 650,

  // Merge behavior
  fieldSourcePreferences: {
    title: ["primary", "goodreads", "storygraph", "google", "openlibrary"],
    // Goodreads separates authors from translators and other contributors;
    // some sources list a translator as a second author.
    author: ["goodreads", "primary", "storygraph", "google", "openlibrary"],
    authors: ["goodreads", "primary", "storygraph", "google", "openlibrary"],
    publisher: ["goodreads", "openlibrary", "google", "storygraph", "primary"],
    publishDate: [
      "goodreads",
      "openlibrary",
      "google",
      "storygraph",
      "primary",
    ],
    totalPage: ["goodreads", "storygraph", "google", "openlibrary", "primary"],
    categories: ["goodreads", "openlibrary", "google", "storygraph", "primary"],
    description: [
      "goodreads",
      "google",
      "openlibrary",
      "storygraph",
      "primary",
    ],
    coverUrl: ["goodreads", "google", "openlibrary", "storygraph", "primary"],
    isbn13: ["primary", "goodreads", "google", "openlibrary", "storygraph"],
    isbn10: ["primary", "goodreads", "google", "openlibrary", "storygraph"],
    originalTitle: ["goodreads", "primary", "storygraph"],
    // Goodreads credits translators edition by edition; StoryGraph sometimes
    // lists a later edition's translator as well.
    translator: ["goodreads", "storygraph", "primary"],
    asin: ["goodreads", "primary"],
    firstPublishDate: ["goodreads", "storygraph", "openlibrary", "primary"],
    characters: ["goodreads", "librarything", "primary"],
    places: ["goodreads", "librarything", "primary"],
    moods: ["storygraph", "primary"],
    pace: ["storygraph", "primary"],
  },

  // Cover behavior
  coverImageMode: "local",
  coverImageFileExtension: "jpg",
};

// ── Service-performance rendering helpers ──────────────────────────────────
const STATUS_DOT_CLASS: Record<ProviderHealthStatus, string> = {
  ok: "bsp-health-dot--ok",
  flaky: "bsp-health-dot--warn",
  blocked: "bsp-health-dot--error",
  down: "bsp-health-dot--error",
};

/** Colour a day-dot by that day's success rate (null = no requests → grey). */
function dotClassForRate(rate: number | null): string {
  if (rate === null) return "bsp-health-dot--none";
  if (rate >= 0.9) return "bsp-health-dot--ok";
  if (rate >= 0.5) return "bsp-health-dot--warn";
  return "bsp-health-dot--error";
}

function dayLabel(offsetFromToday: number): string {
  if (offsetFromToday === 0) return "Today";
  if (offsetFromToday === 1) return "Yesterday";
  return `${offsetFromToday} days ago`;
}

function relTime(ms: number | undefined, nowMs: number): string {
  if (!ms) return "never";
  const diff = nowMs - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function absTime(ms: number | undefined): string {
  if (!ms) return "n/a";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// ── Settings layout ───────────────────────────────────────────────────────
type SettingsTabId = "notes" | "sources" | "search" | "diagnostics" | "support";

const KOFI_URL = "https://ko-fi.com/ducktapekiller";

/**
 * A run of text for descriptions and guides: plain, code, bold, a link, or a
 * bulleted sub-list.
 */
type Rich =
  | string
  | { code: string }
  | { strong: string }
  | { link: string; href: string }
  | { list: readonly (readonly Rich[])[] };

function appendRich(el: HTMLElement, parts: readonly Rich[]): void {
  for (const part of parts) {
    if (typeof part === "string") el.appendText(part);
    else if ("code" in part) el.createEl("code", { text: part.code });
    else if ("strong" in part) el.createEl("strong", { text: part.strong });
    else if ("list" in part) {
      const list = el.createEl("ul");
      for (const item of part.list) appendRich(list.createEl("li"), item);
    } else el.createEl("a", { text: part.link, href: part.href });
  }
}

/** The same text without its formatting, for settings search. */
function plainText(parts: readonly Rich[]): string {
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if ("code" in part) return part.code;
      if ("strong" in part) return part.strong;
      if ("list" in part) return part.list.map(plainText).join(" ");
      return part.link;
    })
    .join("");
}

/** A section or source title with its Lucide icon in a small tinted badge. */
function sectionTitle(text: string, icon: IconName): DocumentFragment {
  return createFragment((fragment) => {
    const title = fragment.createSpan({ cls: "bsp-section-title" });
    setIcon(title.createSpan({ cls: "bsp-section-icon" }), icon);
    title.createSpan({ text });
  });
}

/** The label beside a source's name: ready, saved, optional or still needed. */
type SourceStatus = {
  kind: "ready" | "set" | "optional" | "needed";
  text: string;
};

/**
 * One settings row: the name, description and aliases Obsidian shows and
 * searches, and how to build the row's controls. The same rows make up
 * Obsidian's own searchable settings pages (Obsidian 1.13 and later) and the
 * tabbed page drawn on older versions.
 */
interface Row {
  name: string;
  desc?: string;
  aliases?: string[];
  searchable?: boolean;
  visible?: () => boolean;
  render: (setting: Setting) => void;
}

/** Rows under one heading, which has an icon. */
interface Group {
  heading?: string;
  icon?: IconName;
  rows: Row[];
}

/** A page of settings: a sub-page from Obsidian 1.13, a tab before it. */
interface Page {
  id: SettingsTabId;
  name: string;
  icon: string;
  intro: string;
  groups: Group[];
}

type KeysOfType<V> = {
  [K in keyof BookSearchPluginSettings]-?: BookSearchPluginSettings[K] extends V
    ? K
    : never;
}[keyof BookSearchPluginSettings];

type SecretKey =
  | "hardcoverApiToken"
  | "librarythingApiKey"
  | "storygraphSessionCookie"
  | "storygraphRememberToken";

const PERFORMANCE_SERVICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "goodreads", label: "Goodreads" },
  { id: "google", label: "Google Books" },
  { id: "openlibrary", label: "Open Library" },
  { id: "storygraph", label: "StoryGraph" },
  { id: "hardcover", label: "Hardcover" },
  { id: "librarything", label: "LibraryThing" },
  { id: "calibre", label: "Calibre" },
];

const MERGE_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "description", label: "Description" },
  { field: "categories", label: "Categories" },
  { field: "publisher", label: "Publisher" },
  { field: "publishDate", label: "Publish date" },
  { field: "totalPage", label: "Page count" },
  { field: "coverUrl", label: "Cover URL" },
  { field: "translator", label: "Translator" },
  { field: "originalTitle", label: "Original title" },
];

const MERGE_SOURCES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "primary", label: "Primary (selected source)" },
  { id: "goodreads", label: "Goodreads" },
  { id: "storygraph", label: "StoryGraph" },
  { id: "google", label: "Google Books" },
  { id: "openlibrary", label: "Open Library" },
  { id: "fable", label: "Fable (passive)" },
  { id: "loc", label: "Library of Congress (passive)" },
];

export class BookSearchSettingTab extends PluginSettingTab {
  /** The tab the tabbed page shows (Obsidian before 1.13). */
  private activeTab: SettingsTabId = "notes";

  constructor(
    app: App,
    private plugin: BookSearchPlugin,
  ) {
    super(app, plugin);
  }

  // ── Obsidian 1.13 and later: Obsidian's own settings pages ──────────────

  getSettingDefinitions(): SettingDefinitionItem[] {
    const pages = this.pages();
    const entries: SettingDefinitionItem[] = pages.map((page) => ({
      type: "page",
      name: page.name,
      desc: page.intro,
      items: page.groups.map((group) => ({
        type: "group",
        heading: group.heading,
        items: group.rows.map((row, index) => ({
          ...this.definition(row),
          render: (setting: Setting, settingGroup: SettingGroup) => {
            // Obsidian's group headings are plain text, and it resets them
            // before rendering the rows again, so the first row gives its
            // section the icon each time.
            const { heading, icon } = group;
            // Setting groups came with Obsidian 1.11; these rows are only
            // drawn from 1.13 on, where they always exist. The version check
            // has its own if, the form Obsidian's plugin review accepts.
            if (index === 0 && heading && icon) {
              if (requireApiVersion("1.11.0")) {
                settingGroup.setHeading(sectionTitle(heading, icon));
              }
            }
            setting.settingEl.addClass("bsp-setting");
            row.render(setting);
          },
        })),
      })),
    }));
    return [
      ...entries,
      {
        // Obsidian's page entries cannot carry an icon. This hidden row is
        // drawn after them in the same list, every time the list is drawn,
        // and gives each entry its icon.
        name: "",
        searchable: false,
        visible: false,
        render: (_setting: Setting, settingGroup: SettingGroup) => {
          if (requireApiVersion("1.11.0")) {
            for (const row of Array.from(settingGroup.listEl.children)) {
              const name = row
                .querySelector(".setting-item-name")
                ?.textContent?.trim();
              const page = pages.find((candidate) => candidate.name === name);
              if (!page || row.querySelector(":scope > .bsp-page-icon")) {
                continue;
              }
              const badge = createSpan({ cls: "bsp-page-icon" });
              setIcon(badge, page.icon);
              row.prepend(badge);
            }
          }
        },
      },
    ];
  }

  private definition(row: Row): SettingDefinitionRender {
    return {
      name: row.name,
      desc: row.desc,
      aliases: row.aliases,
      searchable: row.searchable,
      visible: row.visible,
      render: (setting) => {
        setting.settingEl.addClass("bsp-setting");
        row.render(setting);
      },
    };
  }

  /**
   * Obsidian's default writes the whole settings object to data.json, which
   * is how a copy holding only defaults used to replace a user's settings
   * (#9). Any value Obsidian sets goes through the plugin's settings store
   * instead, which writes only what changed.
   */
  setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    return this.plugin.saveSettings();
  }

  /** Redraw the settings after a change to what they show. */
  refresh(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else if (this.containerEl.isShown()) {
      this.drawTabs();
    }
  }

  // ── Before Obsidian 1.13: the same pages as tabs ────────────────────────

  display(): void {
    this.drawTabs();
  }

  /** The settings as tabs, for Obsidian before 1.13, which calls display(). */
  private drawTabs(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("book-search-plugin__settings");

    const pages = this.pages();
    const tabBar = containerEl.createDiv({
      cls: "bsp-tabs",
      attr: { role: "tablist" },
    });
    for (const page of pages) {
      const active = page.id === this.activeTab;
      const button = tabBar.createEl("button", {
        cls: active ? "bsp-tab is-active" : "bsp-tab",
        attr: { type: "button", role: "tab", "aria-selected": String(active) },
      });
      setIcon(button.createSpan({ cls: "bsp-tab-icon" }), page.icon);
      button.createSpan({ text: page.name });
      button.addEventListener("click", () => {
        if (this.activeTab === page.id) return;
        this.activeTab = page.id;
        this.drawTabs();
      });
    }

    const current =
      pages.find((page) => page.id === this.activeTab) ?? pages[0];
    const body = containerEl.createDiv({
      cls: "bsp-tab-body",
      attr: { role: "tabpanel" },
    });
    body.createEl("p", { cls: "bsp-tab-intro", text: current.intro });

    for (const group of current.groups) {
      const rows = group.rows.filter((row) => row.visible?.() ?? true);
      if (rows.length === 0) continue;
      if (group.heading) this.createHeader(group.heading, body, group.icon);
      for (const row of rows) {
        const setting = new Setting(body).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        setting.settingEl.addClass("bsp-setting");
        row.render(setting);
      }
    }
  }

  private createHeader(
    title: string,
    containerEl: HTMLElement,
    icon?: IconName,
  ): void {
    const setting = new Setting(containerEl)
      .setHeading()
      .setName(icon ? sectionTitle(title, icon) : title);
    setting.settingEl.addClass("book-search-plugin__header");
  }

  // ── Pages ───────────────────────────────────────────────────────────────

  private pages(): Page[] {
    return [
      {
        id: "notes",
        name: "Notes",
        icon: "file-text",
        intro: "Where new book notes go and what they contain.",
        groups: this.notesGroups(),
      },
      {
        id: "sources",
        name: "Sources",
        icon: "library",
        intro:
          "Where book data comes from. Goodreads and Open Library need no setup; the others need a key or a login, and each one explains how to get it.",
        groups: this.sourcesGroups(),
      },
      {
        id: "search",
        name: "Search & merging",
        icon: "search",
        intro:
          "What happens before a note is created, and which source wins when sources disagree.",
        groups: this.searchGroups(),
      },
      {
        id: "diagnostics",
        name: "Diagnostics",
        icon: "activity",
        intro:
          "Network behaviour, and how each source has performed over the last three days.",
        groups: this.diagnosticsGroups(),
      },
      {
        id: "support",
        name: "Support",
        icon: "heart",
        intro: "Ways to support Global Book Search, and where to get help.",
        groups: this.supportGroups(),
      },
    ];
  }

  private notesGroups(): Group[] {
    return [
      {
        heading: "Where notes go",
        icon: "folder-open",
        rows: [
          this.folderRow(),
          this.fileNameRow(),
          this.toggleRow(
            "Open new book notes",
            "Open each new book note as soon as it is created.",
            "openPageOnCompletion",
          ),
        ],
      },
      {
        heading: "What a note contains",
        icon: "file-text",
        rows: [
          this.frontmatterRow(),
          this.templateFileRow(),
          this.contentRow(),
          this.toggleRow(
            "Enable series linking",
            "Fill {{seriesLink}} with a [[wikilink]] to the book's series. {{series}} and {{seriesNumber}} are always available. Add the ones you want to your template.",
            "enableSeriesLinking",
            ["Series"],
          ),
        ],
      },
      {
        heading: "Tags",
        icon: "tags",
        rows: [
          this.textRow(
            "Author tag prefix",
            "Add a prefix to the author tag (e.g., 'escritores/').",
            "Example: escritores/",
            "authorTagPrefix",
          ),
          this.textRow(
            "Title tag prefix",
            "Add a prefix to the book title tag (e.g., 'libros/').",
            "Example: libros/",
            "titleTagPrefix",
          ),
        ],
      },
      {
        heading: "Covers",
        icon: "image",
        rows: [
          this.coverModeRow(),
          this.coverExtensionRow(),
          this.coverPathRow(),
        ],
      },
    ];
  }

  private sourcesGroups(): Group[] {
    return [
      {
        heading: "What each source provides",
        icon: "table",
        rows: [this.sourceMapRow()],
      },
      {
        heading: "Searching",
        icon: "search",
        rows: [
          this.defaultSourceRow(),
          this.preferredLanguageRow(),
          this.toggleRow(
            "Show cover images in search",
            "Show book covers in the list of search results.",
            "showCoverImageInSearch",
          ),
          this.toggleRow(
            "A button for each source",
            "Add Goodreads, Open Library, StoryGraph, Google Books, LibraryThing and Hardcover buttons to the window the ribbon button opens. Global search, Calibre and Bulk import are always there.",
            "showIndividualServiceButtons",
          ),
        ],
      },
      {
        heading: "Sources",
        icon: "library",
        rows: [
          this.sourceRow(
            "Goodreads",
            "book-open",
            { kind: "ready", text: "No setup" },
            [
              "Works as it is. When Goodreads blocks a book page, the plugin tries other routes and archived copies, so a note can occasionally miss a field such as the publisher.",
            ],
          ),
        ],
      },
      {
        rows: [
          this.sourceRow(
            "Open Library",
            "landmark",
            { kind: "ready", text: "No setup" },
            ["Works as it is."],
          ),
        ],
      },
      { rows: this.googleRows() },
      { rows: this.storyGraphRows() },
      { rows: this.hardcoverRows() },
      { rows: this.libraryThingRows() },
      { rows: this.calibreRows() },
    ];
  }

  private searchGroups(): Group[] {
    return [
      {
        heading: "Before a note is created",
        icon: "copy-check",
        rows: [
          this.toggleRow(
            "Warn on duplicate",
            "Show a warning before creating a note if one already exists for this book.",
            "warnOnDuplicate",
          ),
        ],
      },
      {
        heading: "Search history",
        icon: "history",
        rows: [
          this.sliderRow(
            "Search history size",
            "Number of recent searches to remember (0 to disable).",
            "maxSearchHistory",
            [0, 20, 1],
          ),
          this.clearSearchHistoryRow(),
        ],
      },
      {
        heading: "When sources disagree",
        icon: "scale",
        rows: [
          this.noteRow(
            "When several sources have a value for a field, the one chosen here wins. Fable and the Library of Congress are consulted only for fields where you choose them.",
          ),
          ...MERGE_FIELDS.map(({ field, label }) =>
            this.fieldSourceRow(field, label),
          ),
        ],
      },
    ];
  }

  private diagnosticsGroups(): Group[] {
    return [
      {
        heading: "Network",
        icon: "network",
        rows: [
          this.toggleRow(
            "Diagnostics mode",
            "Enable verbose logging (Developer Tools console) and richer provider failure details. Useful when a scraper or API changes and results suddenly disappear.",
            "diagnosticsEnabled",
          ),
          this.httpCacheRow(),
          this.sliderRow(
            "HTTP cache TTL (minutes)",
            "How long cached responses are kept before expiring.",
            "httpCacheTtlMinutes",
            [0, 60, 1],
          ),
          this.sliderRow(
            "Rate limit (ms per host)",
            "Minimum delay between requests to the same domain. Higher values reduce blocking.",
            "httpRateLimitMs",
            [0, 2000, 50],
          ),
          this.sliderRow(
            "Retry count",
            "How many times to retry transient failures (429/5xx/timeouts).",
            "httpMaxRetries",
            [0, 5, 1],
          ),
          this.sliderRow(
            "Retry base delay (ms)",
            "Initial retry delay; each subsequent retry doubles.",
            "httpRetryBaseDelayMs",
            [100, 5000, 50],
          ),
        ],
      },
      {
        heading: "Service performance",
        icon: "activity",
        rows: [
          this.noteRow(
            "Reliability of each source over the last three days. Hover a dot for that day's details; use Copy report when filing an issue.",
            true,
          ),
          this.servicePerformanceRow(),
          this.serviceReportRow(),
        ],
      },
    ];
  }

  private supportGroups(): Group[] {
    return [
      { rows: [this.supportCardRow()] },
      {
        heading: "Help and feedback",
        icon: "life-buoy",
        rows: [
          {
            name: "Report a problem or suggest a feature",
            desc: "Open an issue on GitHub. For a problem with a source, include the report from Diagnostics → Copy report.",
            render: (setting) => {
              setting.addButton((button) =>
                button
                  .setButtonText("Open issues")
                  .onClick(() => window.open(`${docUrl}/issues`)),
              );
            },
          },
          {
            name: "Star the project",
            desc: "A star on GitHub helps other readers find the plugin.",
            render: (setting) => {
              setting.addButton((button) =>
                button
                  .setButtonText("Open on GitHub")
                  .onClick(() => window.open(docUrl)),
              );
            },
          },
          {
            name: "Version",
            desc: `Global Book Search ${this.plugin.manifest.version}`,
            render: () => {},
          },
        ],
      },
    ];
  }

  // ── Generic rows ────────────────────────────────────────────────────────

  private save(): void {
    void this.plugin.saveSettings();
  }

  private saveAndRefresh(): void {
    void this.plugin.saveSettings().then(() => this.refresh());
  }

  private toggleRow(
    name: string,
    desc: string,
    key: KeysOfType<boolean>,
    aliases?: string[],
  ): Row {
    return {
      name,
      desc,
      aliases,
      render: (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(this.plugin.settings[key]).onChange((value) => {
            this.plugin.settings[key] = value;
            this.save();
          }),
        );
      },
    };
  }

  private textRow(
    name: string,
    desc: string,
    placeholder: string,
    key: "authorTagPrefix" | "titleTagPrefix",
  ): Row {
    return {
      name,
      desc,
      render: (setting) => {
        setting.addText((text) =>
          text
            .setPlaceholder(placeholder)
            .setValue(this.plugin.settings[key])
            .onChange((value) => {
              this.plugin.settings[key] = value;
              this.save();
            }),
        );
      },
    };
  }

  /**
   * A slider. Obsidian 1.13 and later show its value beside it; on older
   * versions the row shows the value itself.
   */
  private sliderRow(
    name: string,
    desc: string,
    key: KeysOfType<number>,
    [min, max, step]: [number, number, number],
  ): Row {
    return {
      name,
      desc,
      render: (setting) => {
        const valueEl = requireApiVersion("1.13.0")
          ? null
          : setting.controlEl.createSpan({ cls: "bsp-slider-value" });
        valueEl?.setText(String(this.plugin.settings[key]));
        setting.addSlider((slider) =>
          slider
            .setLimits(min, max, step)
            .setValue(this.plugin.settings[key])
            .onChange((value) => {
              this.plugin.settings[key] = value;
              valueEl?.setText(String(value));
              this.save();
            }),
        );
      },
    };
  }

  /** A row of explanatory text, with no controls. */
  /** Where to find which values each source provides. */
  private sourceMapRow(): Row {
    const text: Rich[] = [
      "Every note starts from the same default set of values: title, authors, translator, publisher, dates, pages, ISBNs, description and cover. The sources provide different values, and some provide more: StoryGraph's moods and pace, Hardcover's characters, LibraryThing's first words and dedication. ",
      {
        link: "The README lists them by source",
        href: "https://github.com/DuckTapeKiller/global-book-search#what-each-source-provides",
      },
      ", with the order in which the plugin chooses between them.",
    ];
    return {
      name: "What each source provides",
      desc: plainText(text),
      render: (setting) => {
        const { settingEl } = setting;
        settingEl.empty();
        settingEl.addClass("bsp-block-row");
        appendRich(settingEl.createEl("p"), text);
      },
    };
  }

  private noteRow(text: string, searchable = false): Row {
    return {
      name: "",
      desc: text,
      searchable,
      render: (setting) => setting.settingEl.addClass("bsp-note-row"),
    };
  }

  /**
   * A secret: Obsidian's secret storage where it exists (1.11.4 and later),
   * else a password field. `test` adds a button that reports on it.
   */
  private secretRow(
    name: string,
    key: SecretKey,
    options: {
      desc?: string;
      aliases?: string[];
      placeholder?: string;
      test?: () => Promise<string>;
    },
  ): Row {
    return {
      name,
      desc:
        options.desc ??
        (requireApiVersion("1.11.4")
          ? "Kept in Obsidian's secret storage."
          : "Kept in this plugin's settings."),
      aliases: options.aliases,
      render: (setting) => {
        if (requireApiVersion("1.11.4")) {
          setting.addComponent((el) =>
            new SecretComponent(this.app, el)
              .setValue(this.plugin.settings[key])
              .onChange((value) => {
                this.plugin.settings[key] = value ?? "";
                this.save();
              }),
          );
        } else {
          setting.addText((text) => {
            text.inputEl.type = "password";
            text
              .setPlaceholder(options.placeholder ?? "")
              .setValue(this.plugin.settings[key])
              .onChange((value) => {
                this.plugin.settings[key] = value.trim();
                this.save();
              });
          });
        }
        const test = options.test;
        if (test) {
          setting.addButton((button) =>
            button.setButtonText("Test").onClick(() => {
              button.setDisabled(true);
              void test()
                .then((report) => new Notice(`${name}:\n${report}`, 60_000))
                .finally(() => {
                  // A block, not an expression: setDisabled() returns the
                  // button, and Obsidian's components have a chaining then(),
                  // so returning it here would make the promise resolve with
                  // itself, forever, and freeze Obsidian.
                  button.setDisabled(false);
                });
            }),
          );
        }
      },
    };
  }

  /** The first row of a source: its name, a status label and what it is. */
  private sourceRow(
    name: string,
    icon: IconName,
    status: SourceStatus,
    description: readonly Rich[],
  ): Row {
    return {
      name,
      desc: plainText(description),
      aliases: [status.text],
      render: (setting) => {
        // A heading on the tabbed page; inside Obsidian's own setting groups
        // (1.13 and later) a heading row loses the row padding, so the name
        // is styled by the class instead.
        if (!requireApiVersion("1.13.0")) setting.setHeading();
        setting.settingEl.addClass("bsp-source-heading");
        setting.nameEl.empty();
        setting.nameEl.appendChild(sectionTitle(name, icon));
        setting.nameEl.createSpan({
          cls: `bsp-status bsp-status--${status.kind}`,
          text: status.text,
        });
        setting.descEl.empty();
        appendRich(setting.descEl, description);
      },
    };
  }

  /** A collapsible step-by-step guide, closed until the reader opens it. */
  private guideRow(
    summary: string,
    steps: readonly (readonly Rich[])[],
    notes: readonly (readonly Rich[])[] = [],
  ): Row {
    return {
      name: summary,
      render: (setting) => {
        const { settingEl } = setting;
        settingEl.empty();
        settingEl.addClass("bsp-block-row");
        const details = settingEl.createEl("details", { cls: "bsp-guide" });
        details.createEl("summary", { text: summary });
        const list = details.createEl("ol");
        for (const step of steps) appendRich(list.createEl("li"), step);
        for (const note of notes) appendRich(details.createEl("p"), note);
      },
    };
  }

  // ── Notes ───────────────────────────────────────────────────────────────

  private folderRow(): Row {
    return {
      name: "New file location",
      desc: "New book notes will be placed here.",
      render: (setting) => {
        setting.addSearch((search) => {
          new FolderSuggest(this.app, search.inputEl);
          search
            .setPlaceholder("Example: folder1/folder2")
            .setValue(this.plugin.settings.folder)
            .onChange((folder) => {
              this.plugin.settings.folder = folder;
              this.save();
            });
        });
      },
    };
  }

  private fileNameRow(): Row {
    return {
      name: "New file name",
      aliases: ["File name format"],
      render: (setting) => {
        setting.setClass("book-search-plugin__settings--new_file_name");
        // Built into descEl (not a detached fragment) so it renders on all
        // Obsidian versions.
        setting.descEl.createSpan({
          text: "Enter the file name format. Example: ",
        });
        const hint = setting.descEl.createEl("code", {
          text:
            replaceDateInString(this.plugin.settings.fileNameFormat) ||
            "{{title}} - {{author}}",
        });
        setting.addSearch((search) => {
          new FileNameFormatSuggest(this.app, search.inputEl);
          search
            .setPlaceholder("Example: {{title}} - {{author}}")
            .setValue(this.plugin.settings.fileNameFormat)
            .onChange((value) => {
              this.plugin.settings.fileNameFormat = value?.trim();
              this.save();
              hint.textContent =
                replaceDateInString(value) || "{{title}} - {{author}}";
            });
        });
      },
    };
  }

  private frontmatterRow(): Row {
    return {
      name: "Frontmatter",
      desc: "The frontmatter that is inserted into the text.",
      aliases: ["Properties", "Template language"],
      render: (setting) => {
        setting.settingEl.addClass("bsp-tall-row");
        // The buttons go straight into the description element: a detached
        // DocumentFragment passed to setDesc() rendered as "[object
        // DocumentFragment]" and hid them.
        const buttons = setting.descEl.createDiv({
          cls: "book-search-plugin__settings-button-group",
        });
        buttons
          .createEl("button", { text: "Restore default", cls: "mod-warning" })
          .addEventListener("click", () => {
            this.plugin.settings.frontmatter = DEFAULT_SETTINGS.frontmatter;
            this.saveAndRefresh();
          });

        // A themed Obsidian menu (not the OS menu) of the built-in templates.
        buttons
          .createEl("button", { text: "Language" })
          .addEventListener("click", (event) => {
            const menu = new Menu();
            menu.setUseNativeMenu(false);
            const current = this.plugin.settings.frontmatter;
            for (const [language, template] of Object.entries(
              FRONTMATTER_TEMPLATES,
            )) {
              menu.addItem((item) =>
                item
                  .setTitle(language)
                  .setChecked(template === current)
                  .onClick(() => {
                    this.plugin.settings.frontmatter = template;
                    this.saveAndRefresh();
                  }),
              );
            }
            menu.showAtMouseEvent(event);
          });

        setting.addTextArea((text) => {
          text.inputEl.rows = 15;
          text.inputEl.cols = 40;
          text.inputEl.addClass("book-search-plugin__settings--textarea");
          text
            .setPlaceholder("Enter the frontmatter")
            .setValue(this.plugin.settings.frontmatter)
            .onChange((value) => {
              this.plugin.settings.frontmatter = value;
              this.save();
            });
        });
      },
    };
  }

  private templateFileRow(): Row {
    return {
      name: "Template file",
      desc: "Files will be available as templates.",
      render: (setting) => {
        setting.descEl.createDiv().createEl("a", {
          text: "Example template",
          href: `${docUrl}#example-template`,
        });
        setting.addSearch((search) => {
          new FileSuggest(this.app, search.inputEl);
          search
            .setPlaceholder("Example: templates/template-file")
            .setValue(this.plugin.settings.templateFile)
            .onChange((file) => {
              this.plugin.settings.templateFile = file;
              this.save();
            });
        });
      },
    };
  }

  private contentRow(): Row {
    return {
      name: "Content",
      desc: "This content is automatically added to every new book note after the frontmatter. Use it to include default headings (e.g., # Thoughts), reading logs, or inline scripts for further customization.",
      render: (setting) => {
        setting.settingEl.addClass("bsp-tall-row");
        setting.addTextArea((text) => {
          text.inputEl.rows = 10;
          text.inputEl.cols = 40;
          text.inputEl.addClass("book-search-plugin__settings--textarea");
          text
            .setPlaceholder("Enter the content")
            .setValue(this.plugin.settings.content)
            .onChange((value) => {
              this.plugin.settings.content = value;
              this.save();
            });
        });
      },
    };
  }

  private coverModeRow(): Row {
    return {
      name: "Cover mode",
      desc: "Choose how {{localCoverImage}} is populated: download to vault (local), keep a remote URL, or disable.",
      aliases: ["Cover image"],
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOption("local", "Local (download)")
            .addOption("remote", "Remote URL")
            .addOption("none", "None")
            .setValue(this.plugin.settings.coverImageMode)
            .onChange((value) => {
              this.plugin.settings.coverImageMode = value as
                | "local"
                | "remote"
                | "none";
              // The cover path is shown only for local covers.
              this.saveAndRefresh();
            }),
        );
      },
    };
  }

  private coverExtensionRow(): Row {
    return {
      name: "Cover file extension",
      desc: "File extension used when saving covers locally.",
      render: (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOption("jpg", "JPG")
            .addOption("png", "PNG")
            .addOption("webp", "WebP")
            .setValue(this.plugin.settings.coverImageFileExtension)
            .onChange((value) => {
              this.plugin.settings.coverImageFileExtension = value as
                | "jpg"
                | "png"
                | "webp";
              this.save();
            }),
        );
      },
    };
  }

  private coverPathRow(): Row {
    return {
      name: "Cover image path",
      desc: "Path where cover images are saved (Cover mode: Local).",
      visible: () => this.plugin.settings.coverImageMode === "local",
      render: (setting) => {
        setting.addSearch((search) => {
          new FolderSuggest(this.app, search.inputEl);
          search
            .setPlaceholder("Example: images/covers")
            .setValue(this.plugin.settings.coverImagePath)
            .onChange((value) => {
              this.plugin.settings.coverImagePath = value.trim();
              this.save();
            });
        });
      },
    };
  }

  // ── Sources ─────────────────────────────────────────────────────────────

  private defaultSourceRow(): Row {
    const options: ReadonlyArray<[ServiceProvider, string]> = [
      [ServiceProvider.google, "Google Books"],
      [ServiceProvider.goodreads, "Goodreads"],
      [ServiceProvider.openlibrary, "Open Library"],
      [ServiceProvider.storygraph, "StoryGraph (needs your login)"],
      [ServiceProvider.hardcover, "Hardcover (needs a token)"],
      [ServiceProvider.librarything, "LibraryThing (needs a token)"],
      [ServiceProvider.calibre, "Calibre (your library)"],
    ];
    return {
      name: "Default source",
      desc: "The source searched by the Create new book note and Insert the metadata commands. The ribbon button lets you choose each time.",
      render: (setting) => {
        setting.addDropdown((dropdown) => {
          for (const [id, label] of options) dropdown.addOption(id, label);
          dropdown
            .setValue(
              this.plugin.settings.serviceProvider ?? ServiceProvider.google,
            )
            .onChange((value) => {
              this.plugin.settings.serviceProvider = value as ServiceProvider;
              this.save();
            });
        });
      },
    };
  }

  private preferredLanguageRow(): Row {
    return {
      name: "Preferred language",
      desc: "Language of the results from Google Books, Hardcover and LibraryThing.",
      aliases: ["Locale"],
      render: (setting) => {
        setting.addDropdown((dropdown) => {
          const defaultLocale = window.moment.locale();
          dropdown.addOption(
            defaultLocale,
            `Same as Obsidian: ${languages[defaultLocale] || defaultLocale}`,
          );
          for (const [locale, localeName] of Object.entries(languages)) {
            if (localeName && locale !== defaultLocale) {
              dropdown.addOption(locale, localeName);
            }
          }
          const localeValue = this.plugin.settings.localePreference;
          dropdown
            .setValue(
              localeValue === DEFAULT_SETTINGS.localePreference
                ? defaultLocale
                : localeValue,
            )
            .onChange((value) => {
              this.plugin.settings.localePreference = value;
              this.save();
            });
        });
      },
    };
  }

  private googleRows(): Row[] {
    const hasKey = this.plugin.settings.apiKey.length > 0;
    let pendingKey = "";
    return [
      this.sourceRow(
        "Google Books",
        "book",
        hasKey
          ? { kind: "set", text: "Own key saved" }
          : { kind: "optional", text: "Key optional" },
        [
          "Works without setup, but the free quota it shares with every user often runs out (HTTP 429). Your own free API key avoids that.",
        ],
      ),
      {
        name: "API key",
        desc: hasKey
          ? "A key is saved. It is not shown again; save a new one to replace it, or save an empty field to remove it."
          : "No key saved; the shared quota is used.",
        aliases: ["Google Books"],
        render: (setting) => {
          pendingKey = "";
          setting
            .addText((text) => {
              text.inputEl.type = "password";
              text
                .setPlaceholder("AIza…")
                .onChange((value) => (pendingKey = value.trim()));
            })
            .addButton((button) =>
              button.setButtonText("Save key").onClick(() => {
                const key = pendingKey;
                this.plugin.settings.apiKey = key;
                void this.plugin.saveSettings().then(() => {
                  new Notice(
                    key
                      ? "Google Books API key saved"
                      : "Google Books API key removed",
                  );
                  this.refresh();
                });
              }),
            );
        },
      },
      this.guideRow(
        "How to get a free Google Books API key",
        [
          [
            "Open the ",
            {
              link: "Credentials page",
              href: "https://console.cloud.google.com/apis/credentials",
            },
            " of Google Cloud Console, and choose or create a project if it asks.",
          ],
          [
            "Choose ",
            { strong: "Create credentials → API key" },
            " and copy the key.",
          ],
          [
            "Optionally choose ",
            { strong: "Restrict key" },
            ": if ",
            { strong: "Books API" },
            " is listed under API restrictions, select it; otherwise leave the key unrestricted.",
          ],
          ["Paste the key above and press ", { strong: "Save key" }, "."],
        ],
        [
          [
            "You don't need to find the API in the API Library. Google lists it as \"Books API\", and its documentation says to skip enabling it when it isn't listed.",
          ],
        ],
      ),
      this.toggleRow(
        "Ask for the language on each search",
        "Show a language menu in the Google Books search window.",
        "askForLocale",
        ["Google Books"],
      ),
      this.toggleRow(
        "Page-curl effect on covers",
        "Ask Google Books for covers with a curled page corner.",
        "enableCoverImageEdgeCurl",
        ["Google Books"],
      ),
    ];
  }

  private storyGraphRows(): Row[] {
    const saved =
      !!this.plugin.settings.storygraphSessionCookie ||
      !!this.plugin.settings.storygraphRememberToken;
    const heading = this.sourceRow(
      "StoryGraph",
      "trending-up",
      saved
        ? { kind: "set", text: "Login saved" }
        : { kind: "needed", text: "Needs your login" },
      [
        "StoryGraph has no public API and answers only signed-in requests, so the plugin uses your own login: two cookies from your browser.",
      ],
    );

    if (!requireApiVersion("1.11.4")) {
      return [
        heading,
        this.noteRow(
          "The login needs Obsidian's secret storage, which this version of Obsidian does not have. Update Obsidian to use StoryGraph.",
        ),
      ];
    }

    return [
      heading,
      this.secretRow("Session cookie", "storygraphSessionCookie", {
        desc: "The value of the _storygraph_session cookie.",
        aliases: ["StoryGraph login"],
      }),
      this.secretRow("Remember-me cookie", "storygraphRememberToken", {
        desc: "The value of the remember_user_token cookie.",
        aliases: ["StoryGraph login"],
      }),
      {
        name: "Check the login",
        desc: "Runs one test search on StoryGraph with the saved login.",
        aliases: ["StoryGraph login"],
        render: (setting) => {
          setting.addButton((button) =>
            button.setButtonText("Test login").onClick(() => {
              button.setDisabled(true);
              void this.plugin
                .checkStoryGraphLogin()
                .then((message) => new Notice(message, 15_000))
                .finally(() => {
                  // A block, not an expression: setDisabled() returns the
                  // button, and Obsidian's components have a chaining then(),
                  // so returning it here would make the promise resolve with
                  // itself, forever, and freeze Obsidian.
                  button.setDisabled(false);
                });
            }),
          );
        },
      },
      this.guideRow(
        "How to get your StoryGraph login (about two minutes, on a computer)",
        [
          [
            "Sign in at ",
            {
              link: "app.thestorygraph.com",
              href: "https://app.thestorygraph.com",
            },
            " with ",
            { strong: "Remember me" },
            " ticked.",
          ],
          [
            "Open the developer tools and find the cookies:",
            {
              list: [
                [
                  { strong: "Chrome, Edge or Brave:" },
                  " press Cmd+Option+I (Mac) or F12, then open ",
                  {
                    strong:
                      "Application → Cookies → https://app.thestorygraph.com",
                  },
                  ".",
                ],
                [
                  { strong: "Firefox:" },
                  " press Cmd+Option+I (Mac) or F12, then open ",
                  {
                    strong: "Storage → Cookies → https://app.thestorygraph.com",
                  },
                  ".",
                ],
                [
                  { strong: "Safari:" },
                  " turn on ",
                  {
                    strong:
                      "Settings → Advanced → Show features for web developers",
                  },
                  ", then open ",
                  {
                    strong: "Develop → Show Web Inspector → Storage → Cookies",
                  },
                  ".",
                ],
              ],
            },
          ],
          [
            "Copy the value of ",
            { code: "_storygraph_session" },
            " and the value of ",
            { code: "remember_user_token" },
            ".",
          ],
          [
            "For each one, click ",
            { strong: "Link…" },
            " above, create a secret and paste the value into it.",
          ],
          ["Press ", { strong: "Test login" }, "."],
        ],
        [
          [
            { strong: "Treat these values like your password:" },
            " anyone who has them can use your StoryGraph account. They stay in Obsidian's secret storage (Settings → Keychain), not in your vault's files, and the plugin sends them only to app.thestorygraph.com.",
          ],
          [
            "When StoryGraph stops accepting them (they expire, or you sign out everywhere), the plugin says so; repeat these steps. StoryGraph can change how it treats unofficial clients like this one at any time.",
          ],
        ],
      ),
    ];
  }

  private hardcoverRows(): Row[] {
    return [
      this.sourceRow(
        "Hardcover",
        "book-marked",
        this.plugin.settings.hardcoverApiToken
          ? { kind: "set", text: "Token saved" }
          : { kind: "needed", text: "Needs a token" },
        ["Hardcover's official API, used with your personal token."],
      ),
      this.secretRow("Hardcover token", "hardcoverApiToken", {
        placeholder: "eyJhbGci…",
        test: () => this.plugin.checkHardcover(),
      }),
      this.guideRow("How to get your Hardcover token", [
        [
          "Sign in at ",
          { link: "hardcover.app", href: "https://hardcover.app" },
          ".",
        ],
        [
          "Open ",
          {
            link: "hardcover.app/account/api",
            href: "https://hardcover.app/account/api",
          },
          " (Account → API) and copy the token. It works with or without the word ",
          { code: "Bearer" },
          " in front.",
        ],
        [
          "Click ",
          { strong: "Link…" },
          " above, create a secret and paste the token into it.",
        ],
        ["Press ", { strong: "Test" }, "."],
      ]),
    ];
  }

  private libraryThingRows(): Row[] {
    return [
      this.sourceRow(
        "LibraryThing",
        "bookmark",
        this.plugin.settings.librarythingApiKey
          ? { kind: "set", text: "Token saved" }
          : { kind: "needed", text: "Needs a token" },
        [
          "LibraryThing's Talpa search, used with your free API token. It also fills the Common Knowledge variables such as ",
          { code: "{{characters}}" },
          " and ",
          { code: "{{places}}" },
          ".",
        ],
      ),
      this.secretRow("LibraryThing API token", "librarythingApiKey", {
        placeholder: "API token",
        test: () => this.plugin.checkLibraryThing(),
      }),
      this.guideRow(
        "How to get a LibraryThing API token",
        [
          [
            "Sign in to ",
            { link: "LibraryThing", href: "https://www.librarything.com" },
            ", or create a free account.",
          ],
          [
            "Open the ",
            {
              link: "Developer Hub",
              href: "https://www.librarything.com/developer",
            },
            " while signed in and copy your API token.",
          ],
          [
            "Click ",
            { strong: "Link…" },
            " above, create a secret and paste the token into it.",
          ],
          ["Press ", { strong: "Test" }, "."],
        ],
        [
          [
            "The free token allows 50 searches a day, one per second; for more, LibraryThing asks you to write to talpa@librarything.com.",
          ],
          [
            'LibraryThing sometimes answers automated requests for its book pages with a "High traffic" page. The Common Knowledge variables can then come out empty.',
          ],
        ],
      ),
    ];
  }

  private calibreRows(): Row[] {
    return [
      this.sourceRow(
        "Calibre",
        "hard-drive",
        { kind: "optional", text: "Your library" },
        [
          "Search and import from your own Calibre library, through Calibre's content server.",
        ],
      ),
      {
        name: "Server address",
        desc: "Where Calibre's content server listens.",
        aliases: ["Calibre"],
        render: (setting) => {
          setting.addText((text) =>
            text
              .setPlaceholder("http://localhost:8080")
              .setValue(this.plugin.settings.calibreServerUrl)
              .onChange((value) => {
                this.plugin.settings.calibreServerUrl = value
                  .trim()
                  .replace(/\/+$/, "");
                this.save();
              }),
          );
        },
      },
      {
        name: "Library ID",
        desc: "Usually the folder name of your library.",
        aliases: ["Calibre"],
        render: (setting) => {
          setting.addText((text) =>
            text
              .setPlaceholder("calibre")
              .setValue(this.plugin.settings.calibreLibraryId)
              .onChange((value) => {
                this.plugin.settings.calibreLibraryId = value.trim();
                this.save();
              }),
          );
        },
      },
      this.guideRow("How to turn on Calibre's content server", [
        [
          "In Calibre, choose ",
          { strong: "Connect/share → Start Content server" },
          ".",
        ],
        [
          "To have it start with Calibre, open ",
          { strong: "Preferences → Sharing over the net" },
          " and tick ",
          { strong: "Run server automatically when calibre starts" },
          ".",
        ],
        [
          "On the same computer the address is ",
          { code: "http://localhost:8080" },
          ". From a phone or another computer, use this computer's network address instead, such as ",
          { code: "http://192.168.1.50:8080" },
          ".",
        ],
      ]),
    ];
  }

  // ── Search & merging ────────────────────────────────────────────────────

  private clearSearchHistoryRow(): Row {
    return {
      name: "Clear search history",
      desc: `Currently storing ${this.plugin.settings.searchHistory?.length || 0} search(es).`,
      render: (setting) => {
        setting.addButton((button) =>
          button.setButtonText("Clear").onClick(() => {
            this.plugin.settings.searchHistory = [];
            void this.plugin.saveSettings().then(() => {
              new Notice("Search history cleared");
              // Shows the new count.
              this.refresh();
            });
          }),
        );
      },
    };
  }

  private movePreferenceToFront(field: string, preferred: string): void {
    const prefs = this.plugin.settings.fieldSourcePreferences || {};
    const current = prefs[field] || [];
    prefs[field] = [preferred, ...current.filter((p) => p !== preferred)];
    this.plugin.settings.fieldSourcePreferences = prefs;
  }

  private fieldSourceRow(field: string, label: string): Row {
    return {
      name: label,
      aliases: ["Preferred source", "When sources disagree"],
      render: (setting) => {
        setting.addDropdown((dropdown) => {
          for (const source of MERGE_SOURCES) {
            dropdown.addOption(source.id, source.label);
          }
          dropdown
            .setValue(
              this.plugin.settings.fieldSourcePreferences?.[field]?.[0] ||
                "primary",
            )
            .onChange((value) => {
              this.movePreferenceToFront(field, value);
              this.save();
            });
        });
      },
    };
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────

  private httpCacheRow(): Row {
    return {
      name: "HTTP cache",
      desc: "Cache GET responses in-memory to speed up repeated searches. Clearing also ends the pause on a source that was blocking requests.",
      render: (setting) => {
        setting
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.httpCacheEnabled)
              .onChange((value) => {
                this.plugin.settings.httpCacheEnabled = value;
                this.save();
              }),
          )
          .addButton((button) =>
            button.setButtonText("Clear").onClick(() => {
              clearHttpCache();
              new Notice("HTTP cache cleared");
            }),
          );
      },
    };
  }

  private servicePerformanceRow(): Row {
    return {
      name: "",
      searchable: false,
      render: (setting) => {
        const { settingEl } = setting;
        settingEl.empty();
        settingEl.addClass("bsp-block-row");
        const wrap = settingEl.createDiv({ cls: "bsp-perf-wrap" });
        const now = Date.now();
        for (const service of PERFORMANCE_SERVICES) {
          this.renderServicePerformance(wrap, service.label, service.id, now);
        }
      },
    };
  }

  private serviceReportRow(): Row {
    return {
      name: "",
      searchable: false,
      render: (setting) => {
        setting
          .addButton((button) =>
            button
              .setButtonText("Copy report")
              .setCta()
              .onClick(() => {
                void navigator.clipboard
                  .writeText(this.buildDiagnosticsReport(Date.now()))
                  .then(
                    () => new Notice("Diagnostics report copied to clipboard"),
                    () => new Notice("Could not access the clipboard"),
                  );
              }),
          )
          .addButton((button) =>
            button.setButtonText("Reset").onClick(() => {
              resetProviderHealth();
              clearHistory();
              this.plugin.flushProviderHistory();
              new Notice("Provider history reset");
              this.refresh();
            }),
          );
      },
    };
  }

  private renderServicePerformance(
    parent: HTMLElement,
    label: string,
    providerId: string,
    now: number,
  ): void {
    const summary = summarizeProvider(providerId, now);
    const status = getProviderHealth(providerId).status;

    const box = parent.createDiv({ cls: "bsp-perf-service" });

    const header = box.createDiv({ cls: "bsp-perf-header" });
    header
      .createSpan({ cls: `bsp-health-dot ${STATUS_DOT_CLASS[status]}` })
      .setAttribute("title", `Current status: ${status}`);
    header.createSpan({ text: label });

    // Per-day dots (oldest → newest), coloured by that day's success rate.
    const dayWrap = header.createSpan({ cls: "bsp-perf-days" });
    summary.days.forEach((day, i) => {
      const offset = summary.days.length - 1 - i;
      const title =
        day.total > 0
          ? `${dayLabel(offset)}: ${Math.round((day.rate ?? 0) * 100)}% ok (${day.total} req, ${day.fail} fail)`
          : `${dayLabel(offset)}: no requests`;
      dayWrap
        .createSpan({ cls: `bsp-health-dot ${dotClassForRate(day.rate)}` })
        .setAttribute("title", title);
    });

    header.createSpan({
      cls: "bsp-perf-rate",
      text:
        summary.total > 0
          ? `${Math.round((summary.successRate ?? 0) * 100)}% · ${summary.total} req`
          : "no requests",
    });

    const detail = box.createDiv({ cls: "bsp-perf-detail" });
    if (summary.total === 0 && !summary.lastErrorAt) {
      detail.createDiv({ text: "No requests recorded yet." });
      return;
    }

    detail.createDiv({
      text: `${summary.totalOk} ok · ${summary.totalFail} failed · last success ${relTime(summary.lastSuccessAt, now)}`,
    });

    const reasonParts = FAILURE_REASONS.filter(
      (r) => summary.reasons[r] > 0,
    ).map((r) => `${FAILURE_REASON_LABELS[r]}: ${summary.reasons[r]}`);
    if (reasonParts.length > 0) {
      detail.createDiv({ text: `Failures — ${reasonParts.join(" · ")}` });
    }

    if (summary.lastErrorAt && summary.lastErrorMessage) {
      const code = summary.lastErrorCode
        ? `HTTP ${summary.lastErrorCode} · `
        : "";
      detail.createDiv({
        cls: "bsp-perf-error",
        text: `Last error: ${code}${summary.lastErrorMessage} (${relTime(summary.lastErrorAt, now)})`,
      });
    }
  }

  private buildDiagnosticsReport(now: number): string {
    const lines: string[] = [
      `Global Book Search v${this.plugin.manifest.version} — provider performance (last 3 days)`,
      `Generated: ${absTime(now)}`,
      "",
    ];
    const ids = [
      ...new Set([
        "goodreads",
        "google",
        "openlibrary",
        "storygraph",
        "calibre",
        ...getTrackedProviderIds(),
      ]),
    ];

    for (const id of ids) {
      const s = summarizeProvider(id, now);
      const label = GLOBAL_SEARCH_SOURCE_LABELS[id] || id;
      if (s.total === 0 && !s.lastErrorAt) {
        lines.push(`${label}: no requests`);
        continue;
      }
      const rate =
        s.successRate !== null ? `${Math.round(s.successRate * 100)}%` : "n/a";
      lines.push(`${label}: ${rate} ok · ${s.total} req · ${s.totalFail} fail`);

      const reasonParts = FAILURE_REASONS.filter((r) => s.reasons[r] > 0).map(
        (r) => `${FAILURE_REASON_LABELS[r]}: ${s.reasons[r]}`,
      );
      if (reasonParts.length > 0) lines.push(`  ${reasonParts.join(", ")}`);

      if (s.lastErrorAt && s.lastErrorMessage) {
        const code = s.lastErrorCode ? `HTTP ${s.lastErrorCode} ` : "";
        lines.push(
          `  last error: ${code}"${s.lastErrorMessage}" (${absTime(s.lastErrorAt)})`,
        );
      }
      if (s.lastSuccessAt) lines.push(`  last ok: ${absTime(s.lastSuccessAt)}`);
    }
    return lines.join("\n");
  }

  // ── Support ─────────────────────────────────────────────────────────────

  private supportCardRow(): Row {
    return {
      name: "Support on Ko-fi",
      aliases: ["Donate"],
      render: (setting) => {
        const { settingEl } = setting;
        settingEl.empty();
        settingEl.addClass("bsp-block-row");
        const card = settingEl.createDiv({ cls: "bsp-support" });
        setIcon(card.createDiv({ cls: "bsp-support-icon" }), "heart");
        card.createDiv({
          cls: "bsp-support-title",
          text: "Enjoying Global Book Search?",
        });
        card.createEl("p", {
          text: "Global Book Search is free and open source, made and maintained by DuckTapeKiller. If it is useful to you, you can support its development on Ko-fi.",
        });
        const kofi = card.createEl("a", {
          cls: "bsp-support-button",
          href: KOFI_URL,
          attr: { "aria-label": "Support DuckTapeKiller on Ko-fi" },
        });
        setIcon(kofi.createSpan({ cls: "bsp-support-button-icon" }), "coffee");
        kofi.createSpan({ text: "Support on Ko-fi" });
      },
    };
  }
}
