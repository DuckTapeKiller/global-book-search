import { factoryServiceProvider } from "@apis/base_api";
import { Book } from "@models/book.model";
import { DEFAULT_SETTINGS } from "@settings/settings";
import { GLOBAL_SEARCH_SOURCE_LABELS, ServiceProvider } from "@src/constants";
import BookSearchPlugin from "@src/main";
import { ProviderBlockedError } from "@utils/http";
import languages from "@utils/languages";
import {
  ButtonComponent,
  Modal,
  Notice,
  Setting,
  TextComponent,
  setIcon,
  Platform,
} from "obsidian";
import { BarcodeScannerModal } from "./barcode_scanner_modal";
import { appendHealthDot } from "./health_dot";
import { SourceRelay } from "./source_relay";

export class BookSearchModal extends Modal {
  private readonly SEARCH_BUTTON_TEXT = "Search";
  private readonly REQUESTING_BUTTON_TEXT = "Requesting...";
  private isBusy = false;
  private isSuccess = false;
  private okBtnRef?: ButtonComponent;
  private options: { locale: string };
  private searchInput?: TextComponent;
  private readonly relay = new SourceRelay();

  constructor(
    private plugin: BookSearchPlugin,
    private query: string,
    private serviceProviderId: string | undefined,
    private callback: (error: Error | null, result?: Book[]) => void,
  ) {
    super(plugin.app);
    this.options = { locale: plugin.settings.localePreference };
  }

  /** The source this window searches. */
  private get service(): string {
    return this.serviceProviderId || this.plugin.settings.serviceProvider;
  }

  setBusy(busy: boolean): void {
    this.isBusy = busy;
    if (busy) {
      this.modalEl.addClass("is-searching");
      this.relay.start();
    } else {
      this.modalEl.removeClass("is-searching");
      this.relay.stop();
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
      const settings = await this.plugin.resolveProviderSettings();
      const serviceProvider = factoryServiceProvider(
        settings,
        this.serviceProviderId,
      );
      const searchResults = await serviceProvider.getByQuery(
        this.query,
        this.options,
      );
      this.relay.settle(
        this.service,
        searchResults?.length ? "found" : "empty",
      );
      if (!searchResults?.length) {
        // Keep the modal open so the user can retry with different terms.
        new Notice(`No results found for "${this.query}"`);
        return;
      }

      // Save to search history on success
      this.plugin.addToSearchHistory(this.query);

      this.isSuccess = true;
      this.callback(null, searchResults);
      this.close();
    } catch (err) {
      if (err instanceof ProviderBlockedError) {
        // Keep the modal open, as for an empty result, and explain.
        this.relay.settle(this.service, "failed", err.shortReason);
        new Notice(err.message, 10_000);
        return;
      }
      this.callback(err as Error);
      this.close();
    } finally {
      this.setBusy(false);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("book-search-input-modal");
    const service = this.service;

    // Brand Header
    const headerEl = contentEl.createDiv({
      cls: "book-search-plugin__modal-header",
    });
    const iconEl = headerEl.createDiv({
      cls: "book-search-plugin__modal-icon",
    });
    setIcon(iconEl, service === "calibre" ? "library-big" : "book-open");

    const titleEl = headerEl.createEl("h2", {
      text:
        GLOBAL_SEARCH_SOURCE_LABELS[service] ??
        service.charAt(0).toUpperCase() + service.slice(1),
      cls: "book-search-plugin__modal-title",
    });
    // The source's status dot: it pulses while this window searches.
    this.relay.add(service, appendHealthDot(titleEl, service));

    if (!Platform.isMobile) {
      headerEl.createDiv({
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

    searchSetting.addText((text) => {
      this.searchInput = text;
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
      window.setTimeout(() => this.searchInput?.inputEl.focus(), 50);
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
        const localeName = (languages as Record<string, string>)[locale];
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
