import { App, Modal } from "obsidian";

export class EnrichmentProgressModal extends Modal {
  private statusEl!: HTMLElement;
  private spinnerEl!: HTMLElement;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("book-search-progress-modal");
    this.contentEl.createEl("h3", { text: "Building your note..." });
    this.spinnerEl = this.contentEl.createDiv({ cls: "book-search-spinner" });
    this.statusEl = this.contentEl.createDiv({
      cls: "book-search-progress-status",
    });
    this.setStatus("Starting...");
  }

  setStatus(message: string) {
    if (this.statusEl) {
      this.statusEl.setText(message);
    }
  }

  markDone(message = "Note created.") {
    if (this.spinnerEl) this.spinnerEl.addClass("is-done");
    this.setStatus(message);
    // Auto-close after 1200ms
    setTimeout(() => this.close(), 1200);
  }

  markError(message: string) {
    if (this.spinnerEl) this.spinnerEl.addClass("is-error");
    this.setStatus(message);
    // Auto-close after 2500ms
    setTimeout(() => this.close(), 2500);
  }

  onClose() {
    this.contentEl.empty();
  }
}
