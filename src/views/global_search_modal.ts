import { Modal, Notice, Setting } from "obsidian";
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

    contentEl.createEl("h2", { text: "Global Search" });
    contentEl.createEl("p", {
      text: "Goodreads · Google Books · OpenLibrary · StoryGraph",
      cls: "book-search-global-subtitle",
    });

    this.renderSearchHistory();

    const searchSetting = new Setting(contentEl)
      .setName("Search")
      .setDesc("Search by title, author, or ISBN")
      .addText((text) => {
        text
          .setPlaceholder("Search by title, author, or ISBN")
          .setValue(this.query)
          .onChange((value) => (this.query = value));

        text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter") {
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

  private renderSearchHistory() {
    const history = this.plugin.getSearchHistory();
    if (history.length === 0) return;

    const historyContainer = this.contentEl.createDiv({
      cls: "book-search-history-container",
    });
    historyContainer.createEl("span", {
      text: "Recent: ",
      cls: "book-search-history-label",
    });

    history.forEach((query) => {
      const tag = historyContainer.createEl("span", {
        text: query,
        cls: "book-search-history-tag",
      });
      tag.addEventListener("click", () => {
        this.query = query;
        void this.doSearch();
      });
    });
  }

  async doSearch() {
    if (this.isBusy) return;

    if (!this.query.trim()) {
      new Notice("No query entered.");
      return;
    }

    this.isBusy = true;
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
    }
  }

  onClose() {
    this.contentEl.empty();
    if (!this.isBusy && !this.isSuccess) {
      this.callback(new Error("Cancelled request"));
    }
  }
}
