import { Modal, Setting, Platform, setIcon } from "obsidian";
import BookSearchPlugin from "@src/main";

export class ServiceSelectionModal extends Modal {
  constructor(private plugin: BookSearchPlugin) {
    super(plugin.app);
  }

  onOpen() {
    const { contentEl } = this;

    // Add custom class for styling
    this.modalEl.addClass("book-search-service-selection-modal");

    // Brand Header
    const headerEl = contentEl.createDiv({
      cls: "book-search-plugin__modal-header",
    });
    const iconEl = headerEl.createDiv({
      cls: "book-search-plugin__modal-icon",
    });
    setIcon(iconEl, "library-big");

    headerEl.createEl("h2", {
      text: "Search Books",
      cls: "book-search-plugin__modal-title",
    });

    const buttonContainer = contentEl.createDiv({
      cls: "service-selection-buttons",
    });

    // 1. Global Search (Always)
    const globalBtn = buttonContainer.createEl("button", {
      text: "Global Search",
      cls: "mod-cta book-search-global-btn",
    });

    globalBtn.addEventListener("click", async () => {
      if (Platform.isDesktop) {
        this.close();
        this.plugin.createNewBookNoteGlobal().catch((err) => console.warn(err));
        return;
      }
      const closePromise = this.animateClose();
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        await this.plugin.createNewBookNoteGlobal();
      } catch (err) {
        if ((err as Error).message !== "Cancelled request") console.warn(err);
      } finally {
        await closePromise;
        this.close();
      }
    });

    // 2. Calibre (Always)
    const calibreBtn = buttonContainer.createEl("button", {
      text: "Calibre",
      cls: "mod-cta",
    });

    calibreBtn.addEventListener("click", async () => {
      if (Platform.isDesktop) {
        this.close();
        this.plugin
          .createMultipleCalibreNotes()
          .catch((err) => console.warn(err));
        return;
      }
      const closePromise = this.animateClose();
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        await this.plugin.createMultipleCalibreNotes();
      } catch (err) {
        if ((err as Error).message !== "Cancelled request") console.warn(err);
      } finally {
        await closePromise;
        this.close();
      }
    });

    // 3. Individual services (Conditional)
    if (this.plugin.settings.showIndividualServiceButtons) {
      const services = [
        { label: "Goodreads", value: "goodreads" },
        { label: "OpenLibrary", value: "openlibrary" },
        { label: "StoryGraph", value: "storygraph" },
        { label: "Google Books", value: "google" },
      ];

      services.forEach((service) => {
        const btn = buttonContainer.createEl("button", {
          text: service.label,
          cls: "mod-cta",
        });

        btn.addEventListener("click", async () => {
          if (Platform.isDesktop) {
            this.close();
            this.plugin
              .createNewBookNote(service.value)
              .catch((err) => console.warn(err));
            return;
          }

          const closePromise = this.animateClose();
          await new Promise((resolve) => setTimeout(resolve, 50));

          try {
            await new Promise<void>((resolve, reject) => {
              setTimeout(() => {
                const action = this.plugin.createNewBookNote(service.value);
                action.then(resolve).catch(reject);
              }, 10);
            });
          } catch (err) {
            if (err.message !== "Cancelled request") {
              console.warn(err);
            }
          } finally {
            await closePromise;
            this.close();
          }
        });
      });
    }
  }

  // Graceful close animation - Visual only
  async animateClose(): Promise<void> {
    this.modalEl.addClass("is-closing");
    // Wait for animation duration (250ms)
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
