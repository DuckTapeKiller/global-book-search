import { Modal, Notice, Setting, TextAreaComponent } from "obsidian";
import BookSearchPlugin from "@src/main";

function extractIsbns(text: string): string[] {
  const tokens = (text || "")
    .split(/[\n\r,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const digits = token.replace(/[^0-9X]/gi, "");
    if (digits.length !== 10 && digits.length !== 13) continue;
    const normalized = digits.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

export class BulkImportModal extends Modal {
  private raw = "";
  private skipDuplicates = true;
  private openLastCreated = true;
  private isRunning = false;
  private textArea?: TextAreaComponent;

  constructor(private plugin: BookSearchPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("book-search-bulk-import-modal");

    this.contentEl.createEl("h2", { text: "Bulk import (ISBN list)" });
    this.contentEl.createEl("p", {
      text:
        "Paste ISBN-10/ISBN-13 values (one per line or comma-separated). " +
        "This will fetch metadata and create notes in batch.",
      cls: "modal-description",
    });

    new Setting(this.contentEl)
      .setName("ISBNs")
      .setDesc("Only 10/13-digit ISBNs are processed; other lines are ignored.")
      .addTextArea((area) => {
        this.textArea = area;
        area.setValue(this.raw).onChange((v) => {
          this.raw = v;
        });
        area.inputEl.rows = 8;
        area.inputEl.cols = 40;
      });

    new Setting(this.contentEl)
      .setName("Skip duplicates")
      .setDesc("If a note already exists for an ISBN, skip it.")
      .addToggle((toggle) =>
        toggle.setValue(this.skipDuplicates).onChange((v) => {
          this.skipDuplicates = v;
        }),
      );

    new Setting(this.contentEl)
      .setName("Open last created note")
      .setDesc("After the batch completes, open the last created note.")
      .addToggle((toggle) =>
        toggle.setValue(this.openLastCreated).onChange((v) => {
          this.openLastCreated = v;
        }),
      );

    const actions = new Setting(this.contentEl).setName("Actions");
    actions.addButton((btn) =>
      btn.setButtonText("Paste clipboard").onClick(async () => {
        try {
          if (!navigator.clipboard?.readText) {
            new Notice("Clipboard API not available.");
            return;
          }
          const text = await navigator.clipboard.readText();
          this.raw = text || "";
          this.textArea?.setValue(this.raw);
        } catch (err) {
          new Notice(
            `Clipboard read failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    );

    actions.addButton((btn) =>
      btn
        .setButtonText(this.isRunning ? "Running..." : "Start import")
        .setCta()
        .setDisabled(this.isRunning)
        .onClick(() => void this.start()),
    );
  }

  private async start(): Promise<void> {
    if (this.isRunning) return;

    const isbns = extractIsbns(this.raw);
    if (isbns.length === 0) {
      new Notice("No valid ISBNs found.");
      return;
    }

    this.isRunning = true;
    this.close();
    try {
      await this.plugin.createMultipleBookNotesFromIsbns(isbns, {
        skipDuplicates: this.skipDuplicates,
        openLastCreated: this.openLastCreated,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
