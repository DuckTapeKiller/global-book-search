import { App, Modal, Setting, TFile } from "obsidian";

export enum DuplicateAction {
  OPEN_EXISTING = "open",
  UPDATE_METADATA = "update",
  CREATE_ANYWAY = "create",
  CANCEL = "cancel",
}

export class DuplicateCheckModal extends Modal {
  private result: DuplicateAction = DuplicateAction.CANCEL;
  private resolvePromise: ((value: DuplicateAction) => void) | null = null;

  constructor(
    app: App,
    private readonly existingFile: TFile,
    private readonly bookTitle: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("book-search-duplicate-modal");

    contentEl.createEl("h2", { text: "Book Note Already Exists" });

    contentEl.createEl("p", {
      text: `A note for "${this.bookTitle}" already exists at:`,
    });

    contentEl.createEl("p", {
      cls: "duplicate-file-path",
      text: this.existingFile.path,
    });

    const buttonContainer = contentEl.createDiv({ cls: "duplicate-actions" });

    // Open Existing button
    const openBtn = buttonContainer.createEl("button", {
      text: "Open Existing",
      cls: "mod-cta",
    });
    openBtn.addEventListener("click", () => {
      this.result = DuplicateAction.OPEN_EXISTING;
      this.close();
    });

    // Update Metadata button
    const updateBtn = buttonContainer.createEl("button", {
      text: "Update Metadata",
    });
    updateBtn.addEventListener("click", () => {
      this.result = DuplicateAction.UPDATE_METADATA;
      this.close();
    });

    // Create Anyway button
    const createBtn = buttonContainer.createEl("button", {
      text: "Create Anyway",
    });
    createBtn.addEventListener("click", () => {
      this.result = DuplicateAction.CREATE_ANYWAY;
      this.close();
    });

    // Cancel button
    const cancelBtn = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelBtn.addEventListener("click", () => {
      this.result = DuplicateAction.CANCEL;
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (this.resolvePromise) {
      this.resolvePromise(this.result);
    }
  }

  /**
   * Open the modal and return a promise that resolves with the user's choice
   */
  async waitForChoice(): Promise<DuplicateAction> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }
}

/**
 * Check if a book note already exists in the vault
 */
export function findExistingBookNote(
  app: App,
  folder: string,
  bookTitle: string,
  isbn?: string,
): TFile | null {
  const files = app.vault.getMarkdownFiles();
  const normalizedTitle = bookTitle.toLowerCase().trim();

  // 1. Primary Strategy: Match by ISBN (reliable)
  if (isbn) {
    const byIsbn = files.find((file) => {
      if (folder && !file.path.startsWith(folder)) return false;
      const cache = app.metadataCache.getFileCache(file);
      if (cache?.frontmatter) {
        const fm = cache.frontmatter;
        return (
          fm.isbn === isbn ||
          fm.isbn10 === isbn ||
          fm.isbn13 === isbn ||
          fm.ids === isbn
        );
      }
      return false;
    });
    if (byIsbn) return byIsbn;
  }

  // 2. Secondary Strategy: Exact title match (prevent false positives like "It" matching "It Ends with Us")
  return (
    files.find((file) => {
      if (folder && !file.path.startsWith(folder)) return false;
      return file.basename.toLowerCase().trim() === normalizedTitle;
    }) || null
  );
}
