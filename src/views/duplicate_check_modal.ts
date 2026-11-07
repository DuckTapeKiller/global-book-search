import { App, Modal, TFile } from "obsidian";

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

    contentEl.createEl("h2", { text: "Book note already exists" });

    contentEl.createEl("p", {
      text: `A note for "${this.bookTitle}" already exists at:`,
    });

    contentEl.createEl("p", {
      cls: "duplicate-file-path",
      text: this.existingFile.path,
    });

    const buttonContainer = contentEl.createDiv({ cls: "duplicate-actions" });

    // Open existing button
    const openBtn = buttonContainer.createEl("button", {
      text: "Open existing",
      cls: "mod-cta",
    });
    openBtn.addEventListener("click", () => {
      this.result = DuplicateAction.OPEN_EXISTING;
      this.close();
    });

    // Update metadata button
    const updateBtn = buttonContainer.createEl("button", {
      text: "Update metadata",
    });
    updateBtn.addEventListener("click", () => {
      this.result = DuplicateAction.UPDATE_METADATA;
      this.close();
    });

    // Create anyway button
    const createBtn = buttonContainer.createEl("button", {
      text: "Create anyway",
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
