import { replaceDateInString } from "@utils/utils";
import {
  App,
  Menu,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
  setIcon,
} from "obsidian";

// SecretComponent / app.secretStorage only exist on newer Obsidian; gate on both.
function secretStorageAvailable(app: App): boolean {
  return (
    typeof SecretComponent !== "undefined" &&
    typeof app.secretStorage?.getSecret === "function"
  );
}

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
  librarythingApiKey: string; // LibraryThing developer key (services API)
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
    author: ["primary", "goodreads", "storygraph", "google", "openlibrary"],
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
    translator: ["storygraph", "goodreads", "primary"],
    asin: ["goodreads", "primary"],
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

const SETTINGS_TABS: ReadonlyArray<{
  id: SettingsTabId;
  label: string;
  icon: string;
  intro: string;
}> = [
  {
    id: "notes",
    label: "Notes",
    icon: "file-text",
    intro: "Where new book notes go and what they contain.",
  },
  {
    id: "sources",
    label: "Sources",
    icon: "library",
    intro:
      "Where book data comes from. Goodreads and Open Library need no setup; the others need a key or a login, and each one explains how to get it.",
  },
  {
    id: "search",
    label: "Search & merging",
    icon: "search",
    intro:
      "What happens before a note is created, and which source wins when sources disagree.",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: "activity",
    intro:
      "Network behaviour, and how each source has performed over the last three days.",
  },
  {
    id: "support",
    label: "Support",
    icon: "heart",
    intro: "Ways to support Global Book Search, and where to get help.",
  },
];

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

/** The label beside a source's name: ready, saved, optional or still needed. */
type SourceStatus = {
  kind: "ready" | "set" | "optional" | "needed";
  text: string;
};

export class BookSearchSettingTab extends PluginSettingTab {
  /** The tab shown; kept while the settings window stays open. */
  private activeTab: SettingsTabId = "notes";

  constructor(
    app: App,
    private plugin: BookSearchPlugin,
  ) {
    super(app, plugin);
  }

  private createHeader(title: string, containerEl: HTMLElement) {
    const setting = new Setting(containerEl).setHeading().setName(title);
    setting.settingEl.addClass("book-search-plugin__header");
    return setting;
  }

  private createFileLocationSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("New file location")
      .setDesc("New book notes will be placed here.")
      .addSearch((cb) => {
        try {
          new FolderSuggest(this.app, cb.inputEl);
        } catch (e) {
          console.error(e); // Improved error handling
        }
        cb.setPlaceholder("Example: folder1/folder2")
          .setValue(this.plugin.settings.folder)
          .onChange((new_folder) => {
            this.plugin.settings.folder = new_folder;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createFileNameFormatSetting(containerEl: HTMLElement) {
    const setting = new Setting(containerEl)
      .setClass("book-search-plugin__settings--new_file_name")
      .setName("New file name");
    // Built into descEl (not a detached fragment) so it renders on all Obsidian
    // versions; setDesc(DocumentFragment) shows "[object DocumentFragment]".
    setting.descEl.createSpan({
      text: "Enter the file name format. Example: ",
    });
    const newFileNameHint = setting.descEl.createEl("code", {
      text:
        replaceDateInString(this.plugin.settings.fileNameFormat) ||
        "{{title}} - {{author}}",
    });

    setting.addSearch((cb) => {
      try {
        new FileNameFormatSuggest(this.app, cb.inputEl);
      } catch (e) {
        console.error(e);
      }
      cb.setPlaceholder("Example: {{title}} - {{author}}")
        .setValue(this.plugin.settings.fileNameFormat)
        .onChange((newValue) => {
          this.plugin.settings.fileNameFormat = newValue?.trim();
          void this.plugin.saveSettings().catch((err) => console.warn(err));

          newFileNameHint.textContent =
            replaceDateInString(newValue) || "{{title}} - {{author}}";
        });
    });
  }

  private createFrontmatterSetting(containerEl: HTMLElement) {
    const setting = new Setting(containerEl)
      .setName("Frontmatter")
      .setDesc("The frontmatter that is inserted into the text.");

    // Build the action buttons directly into the description element. Passing a
    // detached DocumentFragment to setDesc() renders as "[object DocumentFragment]"
    // on newer Obsidian, which previously hid these buttons (incl. Languages).
    const buttonContainer = setting.descEl.createDiv();
    buttonContainer.addClass("book-search-plugin__settings-button-group");

    const restoreButton = buttonContainer.createEl("button", {
      text: "Restore default",
      cls: "mod-warning",
    });
    restoreButton.onclick = () => {
      this.plugin.settings.frontmatter = DEFAULT_SETTINGS.frontmatter;
      void this.plugin.saveSettings().then(() => this.display());
    };

    // "Language" button that opens a native, theme-adaptive Obsidian menu.
    // setUseNativeMenu(false) forces the in-app themed menu instead of the OS menu.
    const languageButton = buttonContainer.createEl("button", {
      text: "Language",
    });
    languageButton.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.setUseNativeMenu(false);
      const current = this.plugin.settings.frontmatter;
      Object.keys(FRONTMATTER_TEMPLATES).forEach((lang) => {
        const template =
          FRONTMATTER_TEMPLATES[lang as keyof typeof FRONTMATTER_TEMPLATES];
        menu.addItem((item) => {
          item
            .setTitle(lang)
            .setChecked(template === current)
            .onClick(() => {
              this.plugin.settings.frontmatter = template;
              void this.plugin.saveSettings().then(() => this.display());
            });
        });
      });
      menu.showAtMouseEvent(event);
    });

    setting.addTextArea((text) => {
      text.inputEl.rows = 15;
      text.inputEl.cols = 40;
      text.inputEl.addClass("book-search-plugin__settings--textarea");
      text
        .setPlaceholder("Enter the frontmatter")
        .setValue(this.plugin.settings.frontmatter)
        .onChange((newValue) => {
          this.plugin.settings.frontmatter = newValue;
          void this.plugin.saveSettings().catch((err) => console.warn(err));
        });
    });
  }

  private createContentSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Content")
      .setDesc(
        "This content is automatically added to every new book note after the frontmatter. Use it to include default headings (e.g., # Thoughts), reading logs, or inline scripts for further customization.",
      )
      .addTextArea((text) => {
        text.inputEl.rows = 10;
        text.inputEl.cols = 40;
        text.inputEl.addClass("book-search-plugin__settings--textarea");
        text
          .setPlaceholder("Enter the content")
          .setValue(this.plugin.settings.content)
          .onChange((newValue) => {
            this.plugin.settings.content = newValue;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createTagSettings(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Author tag prefix")
      .setDesc("Add a prefix to the author tag (e.g., 'escritores/').")
      .addText((text) =>
        text
          .setPlaceholder("Example: escritores/")
          .setValue(this.plugin.settings.authorTagPrefix)
          .onChange((value) => {
            this.plugin.settings.authorTagPrefix = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );

    new Setting(containerEl)
      .setName("Title tag prefix")
      .setDesc("Add a prefix to the book title tag (e.g., 'libros/').")
      .addText((text) =>
        text
          .setPlaceholder("Example: libros/")
          .setValue(this.plugin.settings.titleTagPrefix)
          .onChange((value) => {
            this.plugin.settings.titleTagPrefix = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createCoverImagePathSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Cover image path")
      .setDesc("Path where cover images are saved (Cover mode: Local).")
      .addSearch((cb) => {
        try {
          new FolderSuggest(this.app, cb.inputEl);
        } catch {
          // eslint-disable
        }
        cb.setPlaceholder("Enter the path (e.g., Images/Covers)")
          .setValue(this.plugin.settings.coverImagePath)
          .onChange((value) => {
            this.plugin.settings.coverImagePath = value.trim();
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  /** Heading for one source, with its status label and a short description. */
  private createSourceHeading(
    containerEl: HTMLElement,
    name: string,
    status: SourceStatus,
    description: readonly Rich[],
  ): void {
    const setting = new Setting(containerEl).setHeading().setName(name);
    setting.settingEl.addClass("bsp-source-heading");
    setting.nameEl.createSpan({
      cls: `bsp-status bsp-status--${status.kind}`,
      text: status.text,
    });
    appendRich(setting.descEl, description);
  }

  /** A collapsible step-by-step guide, closed until the reader opens it. */
  private createGuide(
    containerEl: HTMLElement,
    summary: string,
    steps: readonly (readonly Rich[])[],
    notes: readonly (readonly Rich[])[] = [],
  ): void {
    const details = containerEl.createEl("details", { cls: "bsp-guide" });
    details.createEl("summary", { text: summary });
    const list = details.createEl("ol");
    for (const step of steps) appendRich(list.createEl("li"), step);
    for (const note of notes) appendRich(details.createEl("p"), note);
  }

  private createDefaultSourceSetting(containerEl: HTMLElement) {
    const options: ReadonlyArray<[ServiceProvider, string]> = [
      [ServiceProvider.google, "Google Books"],
      [ServiceProvider.goodreads, "Goodreads"],
      [ServiceProvider.openlibrary, "Open Library"],
      [ServiceProvider.storygraph, "StoryGraph (needs your login)"],
      [ServiceProvider.hardcover, "Hardcover (needs a token)"],
      [ServiceProvider.librarything, "LibraryThing (needs a key)"],
      [ServiceProvider.calibre, "Calibre (your library)"],
    ];
    new Setting(containerEl)
      .setName("Default source")
      .setDesc(
        "The source searched by the Create new book note and Insert the metadata commands. The ribbon button lets you choose each time.",
      )
      .addDropdown((dropDown) => {
        for (const [id, label] of options) dropDown.addOption(id, label);
        dropDown
          .setValue(
            this.plugin.settings.serviceProvider ?? ServiceProvider.google,
          )
          .onChange((value) => {
            this.plugin.settings.serviceProvider = value as ServiceProvider;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createPreferredLocaleSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Preferred language")
      .setDesc(
        "Language of the results from Google Books, Hardcover and LibraryThing.",
      )
      .addDropdown((dropDown) => {
        const defaultLocale = window.moment.locale();
        dropDown.addOption(
          defaultLocale,
          `Same as Obsidian: ${languages[defaultLocale] || defaultLocale}`,
        );
        Object.keys(languages).forEach((locale) => {
          const localeName = (languages as Record<string, string>)[locale];
          if (localeName && locale !== defaultLocale)
            dropDown.addOption(locale, localeName);
        });
        const localeValue = this.plugin.settings.localePreference;
        dropDown
          .setValue(
            localeValue === DEFAULT_SETTINGS.localePreference
              ? defaultLocale
              : localeValue,
          )
          .onChange((value) => {
            this.plugin.settings.localePreference = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createOpenNoteSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Open new book notes")
      .setDesc("Open each new book note as soon as it is created.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openPageOnCompletion)
          .onChange((value) => {
            this.plugin.settings.openPageOnCompletion = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createShowCoverImageInSearchSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Show cover images in search")
      .setDesc("Show book covers in the list of search results.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCoverImageInSearch)
          .onChange((value) => {
            this.plugin.settings.showCoverImageInSearch = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createNoSetupSources(containerEl: HTMLElement) {
    this.createSourceHeading(
      containerEl,
      "Goodreads",
      { kind: "ready", text: "No setup" },
      [
        "Works as it is. When Goodreads blocks a book page, the plugin tries other routes and archived copies, so a note can occasionally miss a field such as the publisher.",
      ],
    );
    this.createSourceHeading(
      containerEl,
      "Open Library",
      { kind: "ready", text: "No setup" },
      ["Works as it is."],
    );
  }

  private createGoogleApiSettings(containerEl: HTMLElement) {
    const hasKey = this.plugin.settings.apiKey.length > 0;
    this.createSourceHeading(
      containerEl,
      "Google Books",
      hasKey
        ? { kind: "set", text: "Own key saved" }
        : { kind: "optional", text: "Key optional" },
      [
        "Works without setup, but the free quota it shares with every user often runs out (HTTP 429). Your own free API key avoids that.",
      ],
    );

    let pendingKey = "";
    new Setting(containerEl)
      .setName("API key")
      .setDesc(
        hasKey
          ? "A key is saved. It is not shown again; save a new one to replace it, or save an empty field to remove it."
          : "No key saved; the shared quota is used.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("AIza…")
          .onChange((value) => (pendingKey = value.trim()));
      })
      .addButton((button) =>
        button.setButtonText("Save key").onClick(() => {
          this.plugin.settings.apiKey = pendingKey;
          void this.plugin.saveSettings().then(() => {
            new Notice(
              pendingKey
                ? "Google Books API key saved"
                : "Google Books API key removed",
            );
            this.display();
          });
        }),
      );

    this.createGuide(containerEl, "How to get a free Google Books API key", [
      [
        "Open ",
        {
          link: "Google Cloud Console",
          href: "https://console.cloud.google.com/",
        },
        " and choose or create a project.",
      ],
      [
        "Go to ",
        { strong: "APIs & Services → Library" },
        ", search for ",
        { strong: "Books API" },
        " and enable it.",
      ],
      [
        "Go to ",
        { strong: "APIs & Services → Credentials" },
        " and choose ",
        { strong: "Create credentials → API key" },
        ".",
      ],
      ["Copy the key, paste it above and press ", { strong: "Save key" }, "."],
    ]);

    new Setting(containerEl)
      .setName("Ask for the language on each search")
      .setDesc("Show a language menu in the Google Books search window.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.askForLocale).onChange((value) => {
          this.plugin.settings.askForLocale = value;
          void this.plugin.saveSettings().catch((err) => console.warn(err));
        }),
      );

    new Setting(containerEl)
      .setName("Page-curl effect on covers")
      .setDesc("Ask Google Books for covers with a curled page corner.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCoverImageEdgeCurl)
          .onChange((value) => {
            this.plugin.settings.enableCoverImageEdgeCurl = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  /**
   * A secret field (Obsidian's secret storage) or, on Obsidian versions
   * without it, a password field. `test` adds a button that reports on it.
   */
  private createSecretSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    key: "hardcoverApiToken" | "librarythingApiKey",
    placeholder: string,
    test: () => Promise<string>,
  ) {
    const setting = new Setting(containerEl).setName(name).setDesc(description);
    if (secretStorageAvailable(this.app)) {
      setting.addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings[key])
          .onChange((value) => {
            this.plugin.settings[key] = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
    } else {
      setting.addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key])
          .onChange((value) => {
            this.plugin.settings[key] = value.trim();
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
    }
    setting.addButton((button) =>
      button.setButtonText("Test").onClick(() => {
        button.setDisabled(true);
        void test()
          .then((report) => new Notice(`${name}:\n${report}`, 60_000))
          .finally(() => button.setDisabled(false));
      }),
    );
  }

  private createHardcoverApiSettings(containerEl: HTMLElement) {
    this.createSourceHeading(
      containerEl,
      "Hardcover",
      this.plugin.settings.hardcoverApiToken
        ? { kind: "set", text: "Token saved" }
        : { kind: "needed", text: "Needs a token" },
      ["Hardcover's official API, used with your personal token."],
    );
    this.createSecretSetting(
      containerEl,
      "Hardcover token",
      "Kept in Obsidian's secret storage.",
      "hardcoverApiToken",
      "eyJhbGci…",
      () => this.plugin.checkHardcover(),
    );
    this.createGuide(containerEl, "How to get your Hardcover token", [
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
    ]);
  }

  private createLibraryThingApiSettings(containerEl: HTMLElement) {
    this.createSourceHeading(
      containerEl,
      "LibraryThing",
      this.plugin.settings.librarythingApiKey
        ? { kind: "set", text: "Key saved" }
        : { kind: "needed", text: "Needs a key" },
      [
        "LibraryThing's services API, used with your developer key. It also fills the Common Knowledge variables such as ",
        { code: "{{characters}}" },
        " and ",
        { code: "{{places}}" },
        ".",
      ],
    );
    this.createSecretSetting(
      containerEl,
      "LibraryThing developer key",
      "Kept in Obsidian's secret storage.",
      "librarythingApiKey",
      "developer key",
      () => this.plugin.checkLibraryThing(),
    );
    this.createGuide(
      containerEl,
      "How to get a LibraryThing developer key",
      [
        ["Sign in to LibraryThing; a free account is enough."],
        [
          "Open ",
          {
            link: "librarything.com/services/keys.php",
            href: "https://www.librarything.com/services/keys.php",
          },
          " and copy your developer key.",
        ],
        [
          "Click ",
          { strong: "Link…" },
          " above, create a secret and paste the key into it.",
        ],
        ["Press ", { strong: "Test" }, "."],
      ],
      [
        [
          'LibraryThing sometimes answers automated requests for its book pages with a "High traffic" page. The Common Knowledge variables can then come out empty.',
        ],
      ],
    );
  }

  private createStoryGraphLoginSettings(containerEl: HTMLElement) {
    const saved =
      !!this.plugin.settings.storygraphSessionCookie ||
      !!this.plugin.settings.storygraphRememberToken;
    this.createSourceHeading(
      containerEl,
      "StoryGraph",
      saved
        ? { kind: "set", text: "Login saved" }
        : { kind: "needed", text: "Needs your login" },
      [
        "StoryGraph has no public API and answers only signed-in requests, so the plugin uses your own login: two cookies from your browser.",
      ],
    );

    if (!secretStorageAvailable(this.app)) {
      new Setting(containerEl).setDesc(
        "The login needs Obsidian's secret storage, which this version of Obsidian does not have. Update Obsidian to use StoryGraph.",
      );
      return;
    }

    const cookieSetting = (
      name: string,
      cookie: string,
      key: "storygraphSessionCookie" | "storygraphRememberToken",
    ) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(`The value of the ${cookie} cookie.`)
        .addComponent((el) =>
          new SecretComponent(this.app, el)
            .setValue(this.plugin.settings[key])
            .onChange((value) => {
              this.plugin.settings[key] = value;
              void this.plugin.saveSettings().catch((err) => console.warn(err));
            }),
        );
    cookieSetting(
      "Session cookie",
      "_storygraph_session",
      "storygraphSessionCookie",
    );
    cookieSetting(
      "Remember-me cookie",
      "remember_user_token",
      "storygraphRememberToken",
    );

    new Setting(containerEl)
      .setName("Check the login")
      .setDesc("Runs one test search on StoryGraph with the saved login.")
      .addButton((button) =>
        button.setButtonText("Test login").onClick(() => {
          button.setDisabled(true);
          void this.plugin
            .checkStoryGraphLogin()
            .then((message) => new Notice(message, 15_000))
            .finally(() => button.setDisabled(false));
        }),
      );

    this.createGuide(
      containerEl,
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
                { strong: "Storage → Cookies → https://app.thestorygraph.com" },
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
                { strong: "Develop → Show Web Inspector → Storage → Cookies" },
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
    );
  }

  private createCalibreSettings(containerEl: HTMLElement) {
    this.createSourceHeading(
      containerEl,
      "Calibre",
      { kind: "optional", text: "Your library" },
      [
        "Search and import from your own Calibre library, through Calibre's content server.",
      ],
    );
    new Setting(containerEl)
      .setName("Server address")
      .setDesc("Where Calibre's content server listens.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:8080")
          .setValue(this.plugin.settings.calibreServerUrl)
          .onChange((value) => {
            this.plugin.settings.calibreServerUrl = value
              .trim()
              .replace(/\/+$/, "");
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
    new Setting(containerEl)
      .setName("Library ID")
      .setDesc("Usually the folder name of your library.")
      .addText((text) =>
        text
          .setPlaceholder("calibre")
          .setValue(this.plugin.settings.calibreLibraryId)
          .onChange((value) => {
            this.plugin.settings.calibreLibraryId = value.trim();
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
    this.createGuide(containerEl, "How to turn on Calibre's content server", [
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
    ]);
  }

  private createWarnOnDuplicateSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Warn on duplicate")
      .setDesc(
        "Show a warning before creating a note if one already exists for this book.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.warnOnDuplicate)
          .onChange((value) => {
            this.plugin.settings.warnOnDuplicate = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createEnableSeriesLinkingSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Enable series linking")
      .setDesc(
        "Fill {{seriesLink}} with a [[wikilink]] to the book's series. {{series}} and {{seriesNumber}} are always available. Add the ones you want to your template.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSeriesLinking)
          .onChange((value) => {
            this.plugin.settings.enableSeriesLinking = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createSearchHistorySizeSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Search history size")
      .setDesc("Number of recent searches to remember (0 to disable).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.maxSearchHistory)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.maxSearchHistory = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createClearSearchHistorySetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Clear search history")
      .setDesc(
        `Currently storing ${this.plugin.settings.searchHistory?.length || 0} search(es).`,
      )
      .addButton((button) =>
        button.setButtonText("Clear").onClick(() => {
          this.plugin.settings.searchHistory = [];
          void this.plugin.saveSettings().then(() => {
            new Notice("Search history cleared");
            // Refresh to update count
            this.display();
          });
        }),
      );
  }

  private createShowIndividualServiceButtonsSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("A button for each source")
      .setDesc(
        "Add Goodreads, Open Library, StoryGraph, Google Books, LibraryThing and Hardcover buttons to the window the ribbon button opens. Global Search, Calibre and Bulk Import are always there.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showIndividualServiceButtons)
          .onChange(async (value) => {
            this.plugin.settings.showIndividualServiceButtons = value;
            await this.plugin.saveSettings();
          }),
      );
  }

  private createDiagnosticsSettings(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Diagnostics mode")
      .setDesc(
        "Enable verbose logging (Developer Tools console) and richer provider failure details. " +
          "Useful when a scraper or API changes and results suddenly disappear.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.diagnosticsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.diagnosticsEnabled = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("HTTP cache")
      .setDesc(
        "Cache GET responses in-memory to speed up repeated searches. Clearing also ends the pause on a source that was blocking requests.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.httpCacheEnabled)
          .onChange(async (value) => {
            this.plugin.settings.httpCacheEnabled = value;
            await this.plugin.saveSettings();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Clear").onClick(() => {
          clearHttpCache();
          new Notice("HTTP cache cleared");
        }),
      );

    new Setting(containerEl)
      .setName("HTTP cache TTL (minutes)")
      .setDesc("How long cached responses are kept before expiring.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 60, 1)
          .setValue(this.plugin.settings.httpCacheTtlMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.httpCacheTtlMinutes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Rate limit (ms per host)")
      .setDesc(
        "Minimum delay between requests to the same domain. Higher values reduce blocking.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 2000, 50)
          .setValue(this.plugin.settings.httpRateLimitMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.httpRateLimitMs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Retry count")
      .setDesc("How many times to retry transient failures (429/5xx/timeouts).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 5, 1)
          .setValue(this.plugin.settings.httpMaxRetries)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.httpMaxRetries = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Retry base delay (ms)")
      .setDesc("Initial retry delay; each subsequent retry doubles.")
      .addSlider((slider) =>
        slider
          .setLimits(100, 5000, 50)
          .setValue(this.plugin.settings.httpRetryBaseDelayMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.httpRetryBaseDelayMs = value;
            await this.plugin.saveSettings();
          }),
      );
  }

  private createProviderHealthSummary(containerEl: HTMLElement) {
    const now = Date.now();
    const services: Array<{ id: string; label: string }> = [
      { id: "goodreads", label: "Goodreads" },
      { id: "google", label: "Google Books" },
      { id: "openlibrary", label: "OpenLibrary" },
      { id: "storygraph", label: "StoryGraph" },
      { id: "hardcover", label: "Hardcover" },
      { id: "librarything", label: "LibraryThing" },
      { id: "calibre", label: "Calibre" },
    ];

    new Setting(containerEl).setDesc(
      "Reliability of each source over the last three days. Hover a dot for that day's details; use Copy report when filing an issue.",
    );

    const wrap = containerEl.createDiv({ cls: "bsp-perf-wrap" });
    for (const svc of services) {
      this.renderServicePerformance(wrap, svc.label, svc.id, now);
    }

    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText("Copy report")
          .setCta()
          .onClick(() => {
            void navigator.clipboard
              .writeText(this.buildDiagnosticsReport(now))
              .then(
                () => new Notice("Diagnostics report copied to clipboard"),
                () => new Notice("Could not access the clipboard"),
              );
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Reset").onClick(() => {
          resetProviderHealth();
          clearHistory();
          this.plugin.flushProviderHistory();
          new Notice("Provider history reset");
          this.display();
        }),
      );
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

  private movePreferenceToFront(field: string, preferred: string): void {
    const prefs = this.plugin.settings.fieldSourcePreferences || {};
    const current = prefs[field] || [];
    const next = [preferred, ...current.filter((p) => p !== preferred)];
    prefs[field] = next;
    this.plugin.settings.fieldSourcePreferences = prefs;
  }

  private createFieldSourcePreferencesSetting(containerEl: HTMLElement) {
    const fields: Array<{ field: string; label: string }> = [
      { field: "description", label: "Description" },
      { field: "categories", label: "Categories" },
      { field: "publisher", label: "Publisher" },
      { field: "publishDate", label: "Publish date" },
      { field: "totalPage", label: "Page count" },
      { field: "coverUrl", label: "Cover URL" },
      { field: "translator", label: "Translator" },
      { field: "originalTitle", label: "Original title" },
    ];

    const sources: Array<{ id: string; label: string }> = [
      { id: "primary", label: "Primary (selected source)" },
      { id: "goodreads", label: "Goodreads" },
      { id: "storygraph", label: "StoryGraph" },
      { id: "google", label: "Google Books" },
      { id: "openlibrary", label: "OpenLibrary" },
      { id: "fable", label: "Fable (passive)" },
      { id: "loc", label: "Library of Congress (passive)" },
    ];

    containerEl.createEl("p", {
      cls: "bsp-section-note",
      text: "When several sources have a value for a field, the one chosen here wins. Fable and the Library of Congress are consulted only for fields where you choose them.",
    });

    fields.forEach(({ field, label }) => {
      const currentTop =
        this.plugin.settings.fieldSourcePreferences?.[field]?.[0] || "primary";

      new Setting(containerEl).setName(label).addDropdown((dropdown) => {
        sources.forEach((s) => {
          dropdown.addOption(s.id, s.label);
        });
        dropdown.setValue(currentTop).onChange((value) => {
          this.movePreferenceToFront(field, value);
          void this.plugin.saveSettings();
        });
      });
    });
  }

  private createCoverModeSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Cover mode")
      .setDesc(
        "Choose how {{localCoverImage}} is populated: download to vault (local), keep a remote URL, or disable.",
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("local", "Local (download)")
          .addOption("remote", "Remote URL")
          .addOption("none", "None")
          .setValue(this.plugin.settings.coverImageMode)
          .onChange(async (value) => {
            this.plugin.settings.coverImageMode = value as
              | "local"
              | "remote"
              | "none";
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Cover file extension")
      .setDesc("File extension used when saving covers locally.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("jpg", "jpg")
          .addOption("png", "png")
          .addOption("webp", "webp")
          .setValue(this.plugin.settings.coverImageFileExtension)
          .onChange(async (value) => {
            this.plugin.settings.coverImageFileExtension = value as
              | "jpg"
              | "png"
              | "webp";
            await this.plugin.saveSettings();
          });
      });
  }

  private createTemplateFileSetting(containerEl: HTMLElement) {
    const setting = new Setting(containerEl).setName("Template file");
    setting.descEl.createDiv({
      text: "Files will be available as templates.",
    });
    setting.descEl.createEl("a", {
      text: "Example template",
      href: `${docUrl}#example-template`,
    });
    setting.addSearch((cb) => {
      try {
        new FileSuggest(this.app, cb.inputEl);
      } catch {
        // ignore
      }
      cb.setPlaceholder("Example: templates/template-file")
        .setValue(this.plugin.settings.templateFile)
        .onChange((newTemplateFile) => {
          this.plugin.settings.templateFile = newTemplateFile;
          void this.plugin.saveSettings().catch((err) => console.warn(err));
        });
    });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("book-search-plugin__settings");

    const tabBar = containerEl.createDiv({
      cls: "bsp-tabs",
      attr: { role: "tablist" },
    });
    for (const tab of SETTINGS_TABS) {
      const active = tab.id === this.activeTab;
      const button = tabBar.createEl("button", {
        cls: active ? "bsp-tab is-active" : "bsp-tab",
        attr: { type: "button", role: "tab", "aria-selected": String(active) },
      });
      setIcon(button.createSpan({ cls: "bsp-tab-icon" }), tab.icon);
      button.createSpan({ text: tab.label });
      button.addEventListener("click", () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        this.display();
      });
    }

    const current =
      SETTINGS_TABS.find((tab) => tab.id === this.activeTab) ??
      SETTINGS_TABS[0];
    const body = containerEl.createDiv({
      cls: "bsp-tab-body",
      attr: { role: "tabpanel" },
    });
    body.createEl("p", { cls: "bsp-tab-intro", text: current.intro });

    switch (current.id) {
      case "notes":
        this.renderNotesTab(body);
        break;
      case "sources":
        this.renderSourcesTab(body);
        break;
      case "search":
        this.renderSearchTab(body);
        break;
      case "diagnostics":
        this.renderDiagnosticsTab(body);
        break;
      case "support":
        this.renderSupportTab(body);
        break;
    }
  }

  private renderNotesTab(containerEl: HTMLElement) {
    this.createHeader("Where notes go", containerEl);
    this.createFileLocationSetting(containerEl);
    this.createFileNameFormatSetting(containerEl);
    this.createOpenNoteSetting(containerEl);

    this.createHeader("What a note contains", containerEl);
    this.createFrontmatterSetting(containerEl);
    this.createTemplateFileSetting(containerEl);
    this.createContentSetting(containerEl);
    this.createEnableSeriesLinkingSetting(containerEl);

    this.createHeader("Tags", containerEl);
    this.createTagSettings(containerEl);

    this.createHeader("Covers", containerEl);
    this.createCoverModeSetting(containerEl);
    if (this.plugin.settings.coverImageMode === "local") {
      this.createCoverImagePathSetting(containerEl);
    }
  }

  private renderSourcesTab(containerEl: HTMLElement) {
    this.createHeader("Searching", containerEl);
    this.createDefaultSourceSetting(containerEl);
    this.createPreferredLocaleSetting(containerEl);
    this.createShowCoverImageInSearchSetting(containerEl);
    this.createShowIndividualServiceButtonsSetting(containerEl);

    this.createHeader("Sources", containerEl);
    this.createNoSetupSources(containerEl);
    this.createGoogleApiSettings(containerEl);
    this.createStoryGraphLoginSettings(containerEl);
    this.createHardcoverApiSettings(containerEl);
    this.createLibraryThingApiSettings(containerEl);
    this.createCalibreSettings(containerEl);
  }

  private renderSearchTab(containerEl: HTMLElement) {
    this.createHeader("Before a note is created", containerEl);
    this.createWarnOnDuplicateSetting(containerEl);

    this.createHeader("Search history", containerEl);
    this.createSearchHistorySizeSetting(containerEl);
    this.createClearSearchHistorySetting(containerEl);

    this.createHeader("When sources disagree", containerEl);
    this.createFieldSourcePreferencesSetting(containerEl);
  }

  private renderSupportTab(containerEl: HTMLElement) {
    const card = containerEl.createDiv({ cls: "bsp-support" });
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

    this.createHeader("Help and feedback", containerEl);
    new Setting(containerEl)
      .setName("Report a problem or suggest a feature")
      .setDesc(
        "Open an issue on GitHub. For a problem with a source, include the report from Diagnostics → Copy report.",
      )
      .addButton((button) =>
        button
          .setButtonText("Open issues")
          .onClick(() => window.open(`${docUrl}/issues`)),
      );
    new Setting(containerEl)
      .setName("Star the project")
      .setDesc("A star on GitHub helps other readers find the plugin.")
      .addButton((button) =>
        button
          .setButtonText("Open on GitHub")
          .onClick(() => window.open(docUrl)),
      );
    new Setting(containerEl)
      .setName("Version")
      .setDesc(`Global Book Search ${this.plugin.manifest.version}`);
  }

  private renderDiagnosticsTab(containerEl: HTMLElement) {
    this.createHeader("Network", containerEl);
    this.createDiagnosticsSettings(containerEl);

    this.createHeader("Service performance", containerEl);
    this.createProviderHealthSummary(containerEl);
  }
}
