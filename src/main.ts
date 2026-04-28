import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { factoryServiceProvider } from "@apis/base_api";
import { CalibreApi } from "@apis/calibre_api";

import { BookSearchModal } from "@views/book_search_modal";
import { BookSuggestModal } from "@views/book_suggest_modal";
import { ServiceSelectionModal } from "@views/service_selection_modal";
import { CalibreMultiSelectModal } from "@views/calibre_multi_select_modal";
import { CalibreBrowseModal } from "@views/calibre_browse_modal";
import {
  DuplicateCheckModal,
  DuplicateAction,
  findExistingBookNote,
} from "@views/duplicate_check_modal";
import { CursorJumper } from "@utils/cursor_jumper";
import { Book } from "@models/book.model";
import { BookNoteCreator } from "@utils/note_creator";
import {
  BookSearchSettingTab,
  BookSearchPluginSettings,
  DEFAULT_SETTINGS,
} from "@settings/settings";

import { GlobalSearchModal } from "@views/global_search_modal";
import { GlobalSuggestModal } from "@views/global_suggest_modal";
import { EnrichmentProgressModal } from "@views/enrichment_progress_modal";
import { enrichBookByISBN, BookWithSource } from "@apis/global_search";

export default class BookSearchPlugin extends Plugin {
  settings: BookSearchPluginSettings;

  private noteCreator: BookNoteCreator;

  async onload() {
    await this.loadSettings();
    this.noteCreator = new BookNoteCreator(this.app, this.settings);

    // This creates an icon in the left ribbon.
    const ribbonIconEl = this.addRibbonIcon(
      "library-big",
      "Create new book note",
      (evt) => this.selectServiceAndSearch(evt),
    );
    ribbonIconEl.addClass("obsidian-book-search-plugin-ribbon-class");

    // ===== Core Commands =====
    this.addCommand({
      id: "open-book-search-modal",
      name: "Create new book note",
      callback: () => {
        void this.createNewBookNote().catch((err) => console.warn(err));
      },
    });

    this.addCommand({
      id: "open-book-search-modal-to-insert",
      name: "Insert the metadata",
      callback: () => {
        void this.insertMetadata().catch((err) => console.warn(err));
      },
    });

    // ===== Service-Specific Commands =====
    this.addCommand({
      id: "search-google-books",
      name: "Search Google Books",
      callback: () => {
        void this.createNewBookNote("google").catch((err) => console.warn(err));
      },
    });

    this.addCommand({
      id: "search-goodreads",
      name: "Search Goodreads",
      callback: () => {
        void this.createNewBookNote("goodreads").catch((err) =>
          console.warn(err),
        );
      },
    });

    this.addCommand({
      id: "search-calibre",
      name: "Search Calibre (Multi-Select)",
      callback: () => {
        void this.createMultipleCalibreNotes().catch((err) =>
          console.warn(err),
        );
      },
    });

    this.addCommand({
      id: "search-openlibrary",
      name: "Search OpenLibrary",
      callback: () => {
        void this.createNewBookNote("openlibrary").catch((err) =>
          console.warn(err),
        );
      },
    });

    this.addCommand({
      id: "search-storygraph",
      name: "Search StoryGraph",
      callback: () => {
        void this.createNewBookNote("storygraph").catch((err) =>
          console.warn(err),
        );
      },
    });

    this.addCommand({
      id: "browse-calibre",
      name: "Browse Calibre Library",
      callback: () => {
        void this.browseCalibreLibrary().catch((err) => console.warn(err));
      },
    });

    this.addCommand({
      id: "global-book-search",
      name: "Global Search (all sources)",
      callback: () => {
        void this.createNewBookNoteGlobal().catch((err) => console.warn(err));
      },
    });

    // ===== Utility Commands =====
    this.addCommand({
      id: "clear-search-history",
      name: "Clear search history",
      callback: () => {
        this.clearSearchHistory();
        new Notice("Search history cleared");
      },
    });

    // This adds a settings tab
    this.addSettingTab(new BookSearchSettingTab(this.app, this));

    console.debug(
      `Book Search: version ${this.manifest.version} (requires obsidian ${this.manifest.minAppVersion})`,
    );
  }

  showNotice(message: unknown) {
    try {
      const notice =
        message instanceof Error
          ? message.message
          : typeof message === "string"
            ? message
            : JSON.stringify(message) || "Unknown error";
      new Notice(notice);
    } catch {
      //
    }
  }

  // ========================================
  // Search History Management
  // ========================================

  addToSearchHistory(query: string): void {
    if (!query.trim()) return;

    const history = this.settings.searchHistory || [];
    // Remove if already exists (to move to top)
    const filtered = history.filter((h) => h !== query);
    // Add to beginning
    filtered.unshift(query);
    // Limit size
    this.settings.searchHistory = filtered.slice(
      0,
      this.settings.maxSearchHistory || 10,
    );
    void this.saveSettings();
  }

  getSearchHistory(): string[] {
    return this.settings.searchHistory || [];
  }

  clearSearchHistory(): void {
    this.settings.searchHistory = [];
    void this.saveSettings();
  }

  // ========================================
  // Duplicate Detection
  // ========================================

  async checkForDuplicate(
    book: Book,
  ): Promise<{ action: DuplicateAction; file?: TFile }> {
    if (!this.settings.warnOnDuplicate) {
      return { action: DuplicateAction.CREATE_ANYWAY };
    }

    const existingFile = findExistingBookNote(
      this.app,
      this.settings.folder,
      book.title,
      book.isbn13 || book.isbn10 || book.ids,
    );

    if (existingFile) {
      const modal = new DuplicateCheckModal(this.app, existingFile, book.title);
      const action = await modal.waitForChoice();
      return { action, file: existingFile };
    }

    return { action: DuplicateAction.CREATE_ANYWAY };
  }

  // ========================================
  // Core Book Search Functions
  // ========================================

  async searchBookMetadata(
    query?: string,
    serviceProvider?: string,
  ): Promise<Book> {
    const searchedBooks = await this.openBookSearchModal(
      query,
      serviceProvider,
    );
    const book = await this.openBookSuggestModal(searchedBooks);

    // Enrich book with full details if provider supports it
    const api = factoryServiceProvider(this.settings, serviceProvider);

    if (api.getBook) {
      return await api.getBook(book);
    }
    return book;
  }

  async insertMetadata(): Promise<void> {
    try {
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!markdownView?.editor) {
        console.warn("Can not find an active markdown view with editor");
        return;
      }

      const editor = markdownView.editor;
      const originalFile = markdownView.file;
      const book = await this.searchBookMetadata(markdownView.file?.basename);
      const renderedContents = await this.noteCreator.getRenderedContents(book);

      // Re-verify the same note is still active after modals closed
      const currentView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!currentView || currentView.file !== originalFile) {
        this.showNotice("Active note changed — metadata not inserted.");
        return;
      }

      const lastLine = editor.lastLine();
      const lastCh = editor.getLine(lastLine).length;
      editor.replaceRange(
        renderedContents,
        { line: 0, ch: 0 },
        { line: lastLine, ch: lastCh },
      );
      await new CursorJumper(this.app).jumpToNextCursorLocation();
    } catch (err) {
      console.warn(err);
      this.showNotice(err);
    }
  }

  async createNewBookNote(serviceProvider?: string): Promise<void> {
    try {
      const book = await this.searchBookMetadata(undefined, serviceProvider);

      // Check for duplicate
      const { action, file: existingFile } = await this.checkForDuplicate(book);

      if (action === DuplicateAction.CANCEL) {
        return;
      }

      if (action === DuplicateAction.OPEN_EXISTING && existingFile) {
        await this.openNewBookNote(existingFile);
        return;
      }

      const targetFile = await this.noteCreator.create(book);
      await this.openNewBookNote(targetFile);
    } catch (err) {
      if (err instanceof Error && err.message !== "Cancelled request") {
        console.warn(err);
        this.showNotice(err);
      }
    }
  }

  async createMultipleCalibreNotes(): Promise<void> {
    try {
      // Search for books
      const searchedBooks = await this.openBookSearchModal(
        undefined,
        "calibre",
      );

      // Open multi-select modal
      const selectedBooks =
        await this.openCalibreMultiSelectModal(searchedBooks);

      if (selectedBooks.length === 0) {
        return;
      }

      // Enrich selected books with full details (with concurrency limit)
      const api = factoryServiceProvider(this.settings, "calibre");
      const enrichedBooks: Book[] = [];
      const CONCURRENCY_LIMIT = 5;

      for (let i = 0; i < selectedBooks.length; i += CONCURRENCY_LIMIT) {
        const batch = selectedBooks.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await Promise.all(
          batch.map(async (book) => {
            if (api.getBook) {
              return await api.getBook(book);
            }
            return book;
          }),
        );
        enrichedBooks.push(...batchResults);
      }

      // Create notes for all selected books (with duplicate check)
      let successCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      const totalCount = enrichedBooks.length;
      const progressNotice = new Notice(
        `Importing 0 / ${totalCount} books...`,
        0,
      );

      for (const [index, book] of enrichedBooks.entries()) {
        try {
          progressNotice.setMessage(
            `Importing ${index + 1} / ${totalCount}: ${book.title}`,
          );
          // Check for duplicate (skip modal for batch, just skip duplicates)
          if (this.settings.warnOnDuplicate) {
            const existingFile = findExistingBookNote(
              this.app,
              this.settings.folder,
              book.title,
              book.isbn13 || book.isbn10 || book.ids,
            );
            if (existingFile) {
              skippedCount++;
              continue;
            }
          }

          await this.noteCreator.create(book);
          successCount++;
        } catch (err) {
          errors.push(
            `${book.title}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      progressNotice.hide();

      // Show summary
      let message = `Created ${successCount} book note${successCount !== 1 ? "s" : ""}`;
      if (skippedCount > 0) {
        message += `, skipped ${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""}`;
      }
      if (errors.length > 0) {
        message += `. Failed: ${errors.join(", ")}`;
      }
      new Notice(message);
    } catch (err) {
      if (err instanceof Error && err.message !== "Cancelled request") {
        console.warn(err);
        this.showNotice(err);
      }
    }
  }

  /**
   * Browse Calibre library by tags, series, or authors
   */
  async browseCalibreLibrary(): Promise<void> {
    try {
      const calibreApi = new CalibreApi(
        this.settings.calibreServerUrl,
        this.settings.calibreLibraryId,
      );

      const selectedBooks = await new Promise<Book[]>((resolve, reject) => {
        new CalibreBrowseModal(
          this.app,
          calibreApi,
          this.settings.showCoverImageInSearch,
          (error, books) => {
            if (error) {
              reject(error);
            } else {
              resolve(books || []);
            }
          },
        ).open();
      });

      if (selectedBooks.length === 0) {
        return;
      }

      // Enrich selected books with full details (with concurrency limit)
      const enrichedBooks: Book[] = [];
      const CONCURRENCY_LIMIT = 5;

      for (let i = 0; i < selectedBooks.length; i += CONCURRENCY_LIMIT) {
        const batch = selectedBooks.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await Promise.all(
          batch.map(async (book) => {
            if (calibreApi.getBook) {
              return await calibreApi.getBook(book);
            }
            return book;
          }),
        );
        enrichedBooks.push(...batchResults);
      }

      // Create notes for all selected books
      let successCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      const totalCount = enrichedBooks.length;
      const progressNotice = new Notice(
        `Importing 0 / ${totalCount} books...`,
        0,
      );

      for (const [index, book] of enrichedBooks.entries()) {
        try {
          progressNotice.setMessage(
            `Importing ${index + 1} / ${totalCount}: ${book.title}`,
          );
          if (this.settings.warnOnDuplicate) {
            const existingFile = findExistingBookNote(
              this.app,
              this.settings.folder,
              book.title,
              book.isbn13 || book.isbn10 || book.ids,
            );
            if (existingFile) {
              skippedCount++;
              continue;
            }
          }

          await this.noteCreator.create(book);
          successCount++;
        } catch (err) {
          errors.push(
            `${book.title}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      progressNotice.hide();

      let message = `Created ${successCount} book note${successCount !== 1 ? "s" : ""}`;
      if (skippedCount > 0) {
        message += `, skipped ${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""}`;
      }
      if (errors.length > 0) {
        message += `. Failed: ${errors.join(", ")}`;
      }
      new Notice(message);
    } catch (err) {
      if (err instanceof Error && err.message !== "Cancelled request") {
        console.warn(err);
        this.showNotice(err);
      }
    }
  }

  /**
   * Open multi-select modal for Calibre books
   */
  async openCalibreMultiSelectModal(books: Book[]): Promise<Book[]> {
    return new Promise((resolve, reject) => {
      new CalibreMultiSelectModal(
        this.app,
        books,
        this.settings.showCoverImageInSearch,
        (error, selectedBooks) => {
          if (error) {
            reject(error);
          } else {
            resolve(selectedBooks || []);
          }
        },
      ).open();
    });
  }

  async openNewBookNote(targetFile: TFile) {
    if (!this.settings.openPageOnCompletion) return;

    const activeLeaf = this.app.workspace.getLeaf("tab");
    if (!activeLeaf) {
      console.warn("No active leaf");
      return;
    }

    await activeLeaf.openFile(targetFile, { state: { mode: "source" } });
    activeLeaf.setEphemeralState({ rename: "all" });
    await new CursorJumper(this.app).jumpToNextCursorLocation();
  }

  async openBookSearchModal(
    query = "",
    serviceProvider?: string,
  ): Promise<Book[]> {
    return new Promise((resolve, reject) => {
      return new BookSearchModal(
        this,
        query,
        serviceProvider,
        (error, results) => {
          return error ? reject(error) : resolve(results);
        },
      ).open();
    });
  }

  async openBookSuggestModal(books: Book[]): Promise<Book> {
    return new Promise((resolve, reject) => {
      return new BookSuggestModal(
        this.app,
        this.settings.showCoverImageInSearch,
        books,
        (error, selectedBook) => {
          return error ? reject(error) : resolve(selectedBook);
        },
      ).open();
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async createNewBookNoteGlobal(): Promise<void> {
    try {
      // 1. Open global search input modal
      const searchedBooks = await new Promise<BookWithSource[]>(
        (resolve, reject) => {
          new GlobalSearchModal(this, "", (error, results) => {
            if (error) reject(error);
            else resolve(results!);
          }).open();
        },
      );

      // 2. Open global suggest modal (source-tagged results)
      const selectedBook = await new Promise<BookWithSource>(
        (resolve, reject) => {
          new GlobalSuggestModal(
            this.app,
            this.settings.showCoverImageInSearch,
            searchedBooks,
            (error, book) => {
              if (error) reject(error);
              else resolve(book!);
            },
          ).open();
        },
      );

      // 3. Open progress modal
      const progressModal = new EnrichmentProgressModal(this.app);
      progressModal.open();

      try {
        // 4. Enrich by ISBN
        const { book: enrichedBook, sources } = await enrichBookByISBN(
          selectedBook,
          this.settings,
          (msg) => progressModal.setStatus(msg),
        );

        // 5. Duplicate check
        const { action, file: existingFile } =
          await this.checkForDuplicate(enrichedBook);
        if (action === DuplicateAction.CANCEL) {
          progressModal.close();
          return;
        }
        if (action === DuplicateAction.OPEN_EXISTING && existingFile) {
          progressModal.markDone("Opening existing note...");
          await this.openNewBookNote(existingFile);
          return;
        }

        // 6. Create note
        const targetFile = await this.noteCreator.create(enrichedBook);

        const sourcesSummary =
          sources.length > 1 ? `Data from: ${sources.join(", ")}` : "";
        progressModal.markDone(
          sourcesSummary ? `Note created. ${sourcesSummary}` : "Note created.",
        );
        await this.openNewBookNote(targetFile);
      } catch (err) {
        progressModal.markError(
          err instanceof Error ? err.message : "An error occurred.",
        );
        throw err;
      }
    } catch (err) {
      if (err instanceof Error && err.message !== "Cancelled request") {
        console.warn(err);
        this.showNotice(err);
      }
    }
  }

  selectServiceAndSearch(event?: MouseEvent) {
    new ServiceSelectionModal(this).open();
  }
}
