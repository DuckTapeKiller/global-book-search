import { App, Modal, TFile } from "obsidian";
import { frontmatterIsbn } from "@utils/utils";

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
  bookAuthor?: string,
): TFile | null {
  const files = app.vault.getMarkdownFiles();
  const normalizedTitle = bookTitle.toLowerCase().trim();
  const withAuthor = bookAuthor
    ? `${normalizedTitle} - ${bookAuthor.toLowerCase().trim()}`
    : "";
  const wanted = (isbn || "").trim();

  // `folder` must match whole path segments: "Books" must not match "Books2/x.md".
  const inFolder = (path: string): boolean => {
    if (!folder) return true;
    const root = folder.replace(/^\/+|\/+$/g, "");
    if (!root) return true;
    return path === root || path.startsWith(`${root}/`);
  };

  // 1. Primary Strategy: Match by ISBN (reliable)
  if (wanted) {
    const byIsbn = files.find((file) => {
      if (!inFolder(file.path)) return false;
      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) return false;
      // Notes written by this plugin use `isbn 10` / `isbn 13`; also honour the
      // camelCase spellings used by `useDefaultFrontmatter` notes.
      return (
        frontmatterIsbn(fm, 13) === wanted ||
        frontmatterIsbn(fm, 10) === wanted ||
        fm.isbn === wanted ||
        fm.ids === wanted
      );
    });
    if (byIsbn) return byIsbn;
  }

  // 2. Secondary Strategy: exact title match, using the same "<title> - <author>"
  // shape the default file-name format produces (and the bare title, in case the
  // note was renamed or a custom format was used). Avoids false positives like
  // "It" matching "It Ends with Us".
  return (
    files.find((file) => {
      if (!inFolder(file.path)) return false;
      const basename = file.basename.toLowerCase().trim();
      return (
        basename === normalizedTitle ||
        (!!withAuthor && basename === withAuthor)
      );
    }) || null
  );
}
