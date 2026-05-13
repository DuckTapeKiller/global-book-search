import { BaseBooksApiImpl, factoryServiceProvider } from "@apis/base_api";
import { Book } from "@models/book.model";
import { DEFAULT_SETTINGS } from "@settings/settings";
import { ServiceProvider } from "@src/constants";
import BookSearchPlugin from "@src/main";
import languages from "@utils/languages";
import {
  ButtonComponent,
  Modal,
  Notice,
  Setting,
  TextComponent,
  DropdownComponent,
  setIcon,
  Platform,
} from "obsidian";
import { BarcodeScannerModal } from "./barcode_scanner_modal";

export class BookSearchModal extends Modal {
  private readonly SEARCH_BUTTON_TEXT = "Search";
  private readonly REQUESTING_BUTTON_TEXT = "Requesting...";
  private isBusy = false;
  private isSuccess = false;
  private okBtnRef?: ButtonComponent;
  private serviceProvider: BaseBooksApiImpl;
  private options: { locale: string };
  private searchInput?: TextComponent;

  constructor(
    private plugin: BookSearchPlugin,
    private query: string,
    private serviceProviderId: string | undefined,
    private callback: (error: Error | null, result?: Book[]) => void,
  ) {
    super(plugin.app);
    this.options = { locale: plugin.settings.localePreference };
    this.serviceProvider = factoryServiceProvider(
      plugin.settings,
      serviceProviderId,
    );
  }

  setBusy(busy: boolean): void {
    this.isBusy = busy;
    if (busy) {
      this.modalEl.addClass("is-searching");
    } else {
      this.modalEl.removeClass("is-searching");
    }
    this.okBtnRef
      ?.setDisabled(busy)
      .setButtonText(
        busy ? this.REQUESTING_BUTTON_TEXT : this.SEARCH_BUTTON_TEXT,
      );
  }

  async searchBook(): Promise<void> {
    if (!this.query) return void new Notice("No query entered.");
    if (this.isBusy) return;

    this.setBusy(true);
    try {
      const searchResults = await this.serviceProvider.getByQuery(
        this.query,
        this.options,
      );
      if (!searchResults?.length)
        return void new Notice(`No results found for "${this.query}"`);

      // Save to search history on success
      this.plugin.addToSearchHistory(this.query);

      this.isSuccess = true;
      this.callback(null, searchResults);
    } catch (err) {
      this.callback(err as Error);
    } finally {
      this.setBusy(false);
      this.close();
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("book-search-input-modal");
    const service =
      this.serviceProviderId || this.plugin.settings.serviceProvider;

    // Brand Header
    const headerEl = contentEl.createDiv({
      cls: "book-search-plugin__modal-header",
    });
    const iconEl = headerEl.createDiv({
      cls: "book-search-plugin__modal-icon",
    });
    setIcon(iconEl, service === "calibre" ? "library-big" : "book-open");

    headerEl.createEl("h2", {
      text:
        (service as string).charAt(0).toUpperCase() +
        (service as string).slice(1),
      cls: "book-search-plugin__modal-title",
    });

    if (!Platform.isMobile) {
      headerEl.createEl("div", {
        text: "Search book",
        cls: "book-search-plugin__search-modal--subtitle",
      });
    }

    if (
      (service as ServiceProvider) === ServiceProvider.google &&
      this.plugin.settings.askForLocale
    )
      this.renderSelectLocale();

    const searchSetting = new Setting(contentEl);
    if (!Platform.isMobile) {
      searchSetting.setName("Search").setDesc("Search by keyword or ISBN");
    }

    searchSetting.addText((text) => {
      this.searchInput = text;
      const parentEl = text.inputEl.parentElement;
      if (parentEl) {
        parentEl.addClass("book-search-input-container");
        const scanButton = parentEl.createEl("button", {
          cls: "book-search-scan-button",
          attr: { title: "Scan barcode" },
        });
        setIcon(scanButton, "scan");
        scanButton.addEventListener("click", () => {
          new BarcodeScannerModal(this.app, (isbn) => {
            this.query = isbn;
            this.searchInput?.setValue(isbn);
            void this.searchBook();
          }).open();
        });
      }

      text
        .setPlaceholder("Search by keyword or ISBN")
        .setValue(this.query)
        .onChange((value) => (this.query = value));

      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          void this.searchBook();
        }
      });

      // Focus the input
      setTimeout(() => this.searchInput?.inputEl.focus(), 50);
    });

    new Setting(this.contentEl).addButton((btn) => {
      this.okBtnRef = btn
        .setButtonText(this.SEARCH_BUTTON_TEXT)
        .setCta()
        .onClick(() => void this.searchBook());
    });
  }

  renderSelectLocale() {
    const defaultLocale = window.moment.locale();
    new Setting(this.contentEl).setName("Locale").addDropdown((dropdown) => {
      dropdown.addOption(
        defaultLocale,
        `${languages[defaultLocale] || defaultLocale}`,
      );
      Object.keys(languages).forEach((locale) => {
        const localeName = languages[locale];
        if (localeName && locale !== defaultLocale)
          dropdown.addOption(locale, localeName);
      });
      dropdown
        .setValue(
          this.options.locale === DEFAULT_SETTINGS.localePreference
            ? defaultLocale
            : this.options.locale,
        )
        .onChange((locale) => (this.options.locale = locale));
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    // Ensure callback is called to prevent hanging promises
    // Only error if we haven't successfully found a book
    if (!this.isBusy && !this.isSuccess) {
      this.callback(new Error("Cancelled request"));
    }
  }
}
