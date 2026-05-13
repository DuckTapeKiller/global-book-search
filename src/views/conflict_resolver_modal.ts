import { Modal, App, Setting } from "obsidian";
import { EnrichmentResult } from "@models/accuracy.model";
import { Book } from "@models/book.model";

export class ConflictResolverModal extends Modal {
  private resolvedBook: Book;
  private _submitted = false;

  constructor(
    app: App,
    private result: EnrichmentResult,
    private onSubmit: (book: Book | null) => void,
  ) {
    super(app);
    this.resolvedBook = { ...result.book };
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("book-search-accuracy-modal");
    this.modalEl.addClass("conflict-resolver-modal");

    contentEl.createEl("h2", { text: "Data Conflict Resolver" });
    contentEl.createEl("p", {
      text: "Sources disagree on the following fields. Please pick the most accurate data for your vault.",
      cls: "modal-description",
    });

    const scrollEl = contentEl.createDiv({ cls: "conflict-scroll-area" });

    this.result.conflicts.forEach((conflict) => {
      const fieldContainer = scrollEl.createDiv({
        cls: "conflict-field-group",
      });
      fieldContainer.createEl("h4", {
        text: conflict.label,
        cls: "field-label",
      });

      const optionsContainer = fieldContainer.createDiv({
        cls: "conflict-options",
      });

      conflict.values.forEach((v, idx) => {
        const optionId = `conflict-${conflict.fieldName}-${idx}`;
        const optionEl = optionsContainer.createDiv({
          cls: "conflict-option-card",
        });

        const radio = optionEl.createEl("input", {
          type: "radio",
          attr: {
            name: conflict.fieldName,
            id: optionId,
          },
        });

        // Pre-select quorum or current value
        if (
          String(v.value) ===
          String(this.resolvedBook[conflict.fieldName as keyof Book])
        ) {
          radio.checked = true;
        }

        radio.addEventListener("change", () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.resolvedBook as any)[conflict.fieldName] = v.value;
          optionsContainer
            .querySelectorAll(".conflict-option-card")
            .forEach((el) => el.removeClass("is-selected"));
          optionEl.addClass("is-selected");
        });

        if (radio.checked) optionEl.addClass("is-selected");

        const label = optionEl.createEl("label", { attr: { for: optionId } });
        label.createDiv({ text: String(v.value), cls: "value-text" });

        const sourceRow = label.createDiv({ cls: "source-row" });
        sourceRow.createSpan({ text: v.source, cls: "source-name" });
        if (v.isQuorum) {
          sourceRow.createSpan({ text: "Most Frequent", cls: "quorum-tag" });
        }
      });
    });

    const footer = contentEl.createDiv({ cls: "modal-footer" });
    new Setting(footer).addButton((btn) => {
      btn
        .setButtonText("Finalize Accurate Note")
        .setCta()
        .onClick(() => {
          this._submitted = true;
          this.onSubmit(this.resolvedBook);
          this.close();
        });
    });
  }

  onClose() {
    this.contentEl.empty();
    if (!this._submitted) {
      this.onSubmit(null);
    }
  }
}
