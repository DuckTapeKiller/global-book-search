import { toErrorMessage } from "@utils/json";
import { Modal, Notice, Setting, setIcon, TextComponent } from "obsidian";
import BookSearchPlugin from "@src/main";
import { globalSearch, BookWithSource } from "@apis/global_search";
import { BarcodeScannerModal } from "./barcode_scanner_modal";
import { appendHealthDot } from "./health_dot";
import { SourceRelay } from "./source_relay";

const SOURCES: ReadonlyArray<{ label: string; id: string }> = [
  { label: "Goodreads", id: "goodreads" },
  { label: "Google Books", id: "google" },
  { label: "Open Library", id: "openlibrary" },
  { label: "StoryGraph", id: "storygraph" },
  { label: "LibraryThing", id: "librarything" },
  { label: "Hardcover", id: "hardcover" },
];

export class GlobalSearchModal extends Modal {
  private query: string;
  private isBusy = false;
  private isSuccess = false;
  private statusEl!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private searchInput?: TextComponent;
  private readonly relay = new SourceRelay();

  constructor(
    private plugin: BookSearchPlugin,
    query = "",
    private callback: (error: Error | null, result?: BookWithSource[]) => void,
  ) {
    super(plugin.app);
    this.query = query;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("book-search-global-modal");

    // Brand Header
    const headerEl = contentEl.createDiv({
      cls: "book-search-plugin__modal-header",
    });
    const iconEl = headerEl.createDiv({
      cls: "book-search-plugin__modal-icon",
    });
    setIcon(iconEl, "library-big");

    headerEl.createEl("h2", {
      text: "Global search",
      cls: "book-search-plugin__modal-title",
    });

    // The sources, three to a row, each dot above its name, on computers and
    // phones alike. The dots show each source's health, pulse in turn while
    // a search runs and then show how each source answered.
    const sourcesEl = contentEl.createDiv({
      cls: "book-search-global-sources",
    });
    for (const p of SOURCES) {
      const sourceEl = sourcesEl.createDiv({
        cls: "book-search-global-source",
      });
      const dot = appendHealthDot(sourceEl, p.id);
      const setup = this.setupNeeded(p.id);
      if (setup) {
        // Not set up: the source takes no part in a search until it is, so
        // its dot stays grey and says why instead of "Working".
        dot.removeClass(
          "bsp-health-dot--ok",
          "bsp-health-dot--warn",
          "bsp-health-dot--error",
        );
        dot.addClass("bsp-health-dot--none");
        dot.setAttribute("title", setup);
        sourceEl.addClass("is-not-set-up");
      } else {
        this.relay.add(p.id, dot);
      }
      sourceEl.createSpan({
        text: p.label,
        cls: "book-search-global-source-name",
      });
      // A phone has no hover: a tap says what the dot means ("StoryGraph:
      // sign-in needed").
      sourceEl.addEventListener("click", () => {
        const status = dot.getAttribute("title");
        if (status) new Notice(`${p.label}: ${status}`);
      });
    }

    const searchSetting = new Setting(contentEl);

    searchSetting.addText((text) => {
      const parentEl = text.inputEl.parentElement;
      if (parentEl) {
        parentEl.addClass("book-search-input-container");
        const scanButton = parentEl.createEl("button", {
          cls: "clickable-icon book-search-scan-button",
          attr: { title: "Scan barcode" },
        });
        setIcon(scanButton, "scan");
        scanButton.addEventListener("click", () => {
          new BarcodeScannerModal(this.app, (isbn) => {
            this.query = isbn;
            text.setValue(isbn);
            void this.doSearch();
          }).open();
        });
      }

      text
        .setPlaceholder("Search by title, author, or ISBN")
        .setValue(this.query)
        .onChange((value) => (this.query = value));

      text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.isComposing) {
          void this.doSearch();
        }
      });

      // Auto-focus
      this.searchInput = text;
      window.setTimeout(() => text.inputEl.focus(), 50);
    });

    this.statusEl = this.contentEl.createDiv({
      cls: "book-search-global-status",
    });
    this.statusTextEl = this.statusEl.createSpan();

    const searchButton = contentEl.createEl("button", {
      text: "Search",
      cls: "mod-cta",
    });

    searchButton.addEventListener("click", () => void this.doSearch());
  }

  /** Why a source that needs setting up cannot search yet, or "" when it can. */
  private setupNeeded(providerId: string): string {
    const settings = this.plugin.settings;
    const where = "(Settings → Global Book Search → Sources)";
    if (
      providerId === "storygraph" &&
      !settings.storygraphSessionCookie &&
      !settings.storygraphRememberToken
    ) {
      return `Needs your login ${where}`;
    }
    if (providerId === "hardcover" && !settings.hardcoverApiToken) {
      return `Needs a token ${where}`;
    }
    if (providerId === "librarything" && !settings.librarythingApiKey) {
      return `Needs a token ${where}`;
    }
    return "";
  }

  async doSearch() {
    if (this.isBusy) return;

    if (!this.query.trim()) {
      new Notice("No query entered.");
      return;
    }

    this.isBusy = true;
    this.modalEl.addClass("is-searching");
    this.statusEl.addClass("is-active");
    this.relay.start();
    const searchButton =
      this.contentEl.querySelector<HTMLButtonElement>("button.mod-cta");
    const originalText = searchButton.textContent;
    searchButton.textContent = "Searching...";
    searchButton.disabled = true;

    try {
      const settings = await this.plugin.resolveProviderSettings();
      const results = await globalSearch(
        this.query,
        settings,
        {
          locale: settings.localePreference,
          vaultIndex: this.plugin.getVaultIndex(),
          onSourceDone: (id, outcome, reason) =>
            this.relay.settle(id, outcome, reason),
        },
        (msg) => this.statusTextEl.setText(msg),
      );

      if (results.length === 0) {
        new Notice("No results found.");
        this.isBusy = false;
        this.modalEl.removeClass("is-searching");
        this.statusTextEl.setText("");
        searchButton.textContent = originalText;
        searchButton.disabled = false;
        return;
      }

      this.plugin.addToSearchHistory(this.query);
      this.isSuccess = true;
      this.statusTextEl.setText("");
      this.callback(null, results);
      this.close();
    } catch (error) {
      this.statusTextEl.setText("");
      this.callback(
        error instanceof Error ? error : new Error(toErrorMessage(error)),
      );
      this.close();
    } finally {
      this.isBusy = false;
      this.modalEl.removeClass("is-searching");
      this.relay.stop();
    }
  }

  onClose() {
    this.contentEl.empty();
    if (!this.isBusy && !this.isSuccess) {
      this.callback(new Error("Cancelled request"));
    }
  }
}
