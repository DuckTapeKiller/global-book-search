import { Modal, Notice, Setting, setIcon, Platform } from "obsidian";
import BookSearchPlugin from "@src/main";
import { globalSearch, BookWithSource } from "@apis/global_search";

export class GlobalSearchModal extends Modal {
  private query: string;
  private isBusy = false;
  private isSuccess = false;
  private statusEl!: HTMLElement;

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
      text: "Global Search",
      cls: "book-search-plugin__modal-title",
    });

    if (!Platform.isMobile) {
      contentEl.createEl("p", {
        text: "Goodreads · Google Books · OpenLibrary · StoryGraph",
        cls: "book-search-global-subtitle",
      });
    }

    const searchSetting = new Setting(contentEl);
    if (!Platform.isMobile) {
      searchSetting
        .setName("Search")
        .setDesc("Search by title, author, or ISBN");
    }

    searchSetting.addText((text) => {
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
      setTimeout(() => text.inputEl.focus(), 50);
    });

    this.statusEl = this.contentEl.createDiv({
      cls: "book-search-global-status",
    });

    const searchButton = contentEl.createEl("button", {
      text: "Search",
      cls: "mod-cta",
    });

    searchButton.addEventListener("click", () => void this.doSearch());
  }

  async doSearch() {
    if (this.isBusy) return;

    if (!this.query.trim()) {
      new Notice("No query entered.");
      return;
    }

    this.isBusy = true;
    this.modalEl.addClass("is-searching");
    const searchButton = this.contentEl.querySelector(
      "button.mod-cta",
    ) as HTMLButtonElement;
    const originalText = searchButton.textContent;
    searchButton.textContent = "Searching...";
    searchButton.disabled = true;

    try {
      const results = await globalSearch(
        this.query,
        this.plugin.settings,
        { locale: this.plugin.settings.localePreference },
        (msg) => {
          if (this.statusEl) this.statusEl.setText(msg);
        },
      );

      if (results.length === 0) {
        new Notice("No results found.");
        this.isBusy = false;
        this.modalEl.removeClass("is-searching");
        if (this.statusEl) this.statusEl.setText("");
        searchButton.textContent = originalText;
        searchButton.disabled = false;
        return;
      }

      this.plugin.addToSearchHistory(this.query);
      this.isSuccess = true;
      if (this.statusEl) this.statusEl.setText("");
      this.callback(null, results);
      this.close();
    } catch (error) {
      if (this.statusEl) this.statusEl.setText("");
      this.callback(error instanceof Error ? error : new Error(String(error)));
      this.close();
    } finally {
      this.isBusy = false;
      this.modalEl.removeClass("is-searching");
    }
  }

  onClose() {
    this.contentEl.empty();
    if (!this.isBusy && !this.isSuccess) {
      this.callback(new Error("Cancelled request"));
    }
  }
}
