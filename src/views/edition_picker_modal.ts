import { Modal, App, Setting } from "obsidian";
import { BookEdition } from "@models/accuracy.model";

export class EditionPickerModal extends Modal {
  constructor(
    app: App,
    private bookTitle: string,
    private editions: BookEdition[],
    private onSubmit: (edition: BookEdition) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("book-search-accuracy-modal");

    contentEl.createEl("h2", { text: "Select Edition" });
    contentEl.createEl("p", {
      text: `Multiple editions found for "${this.bookTitle}". Please pick the one that matches your book for the most accurate metadata.`,
      cls: "modal-description",
    });

    const listEl = contentEl.createDiv({ cls: "edition-list" });

    this.editions.forEach((edition) => {
      const itemEl = listEl.createDiv({ cls: "edition-item-card" });

      const infoEl = itemEl.createDiv({ cls: "edition-info" });
      infoEl.createEl("strong", {
        text: edition.isbn13 || edition.isbn10 || "Unknown ISBN",
      });

      const metadataStr = [
        edition.publisher,
        edition.publishDate,
        edition.totalPage ? `${edition.totalPage} pages` : null,
      ]
        .filter(Boolean)
        .join(" • ");

      infoEl.createEl("div", { text: metadataStr, cls: "edition-meta" });
      infoEl.createEl("div", {
        text: `Source: ${edition._providerId}`,
        cls: "edition-source-tag",
      });

      new Setting(itemEl).addButton((btn) => {
        btn
          .setButtonText("Select Edition")
          .setCta()
          .onClick(() => {
            this.onSubmit(edition);
            this.close();
          });
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
