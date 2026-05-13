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

    const sorted = [...this.editions].sort(
      (a, b) => (b.score || 0) - (a.score || 0),
    );

    sorted.forEach((edition, idx) => {
      const itemEl = listEl.createDiv({ cls: "edition-item-card" });

      if (edition.coverUrl) {
        const img = itemEl.createEl("img", {
          cls: "edition-cover-image",
          attr: { src: edition.coverUrl, loading: "lazy" },
        });
        img.onerror = () => img.remove();
      }

      const infoEl = itemEl.createDiv({ cls: "edition-info" });
      infoEl.createEl("strong", {
        text: edition.isbn13 || edition.isbn10 || "Unknown ISBN",
      });

      if (idx === 0) {
        infoEl.createEl("div", {
          text: "Recommended",
          cls: "edition-recommended",
        });
      }

      const metadataStr = [
        edition.publisher,
        edition.publishDate,
        edition.totalPage ? `${edition.totalPage} pages` : null,
      ]
        .filter(Boolean)
        .join(" • ");

      infoEl.createEl("div", { text: metadataStr, cls: "edition-meta" });
      infoEl.createEl("div", {
        text: `Score: ${edition.score ?? 0}`,
        cls: "edition-score",
      });
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
