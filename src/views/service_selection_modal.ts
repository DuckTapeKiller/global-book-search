import { Modal, Setting, Platform } from "obsidian";
import BookSearchPlugin from "@src/main";

export class ServiceSelectionModal extends Modal {
  constructor(private plugin: BookSearchPlugin) {
    super(plugin.app);
  }

  onOpen() {
    const { contentEl } = this;

    // Add custom class for styling
    this.modalEl.addClass("book-search-service-selection-modal");

    contentEl.createEl("h2", { text: "Select Service" });

    const services = [
      { label: "Goodreads", value: "goodreads" },
      { label: "Calibre", value: "calibre" },
      { label: "OpenLibrary", value: "openlibrary" },
      { label: "Google Books", value: "google" },
    ];

    const buttonContainer = contentEl.createDiv({
      cls: "service-selection-buttons",
    });

    services.forEach((service) => {
      const btn = buttonContainer.createEl("button", {
        text: service.label,
        cls: "mod-cta",
      });

      btn.addEventListener("click", async () => {
        // Platform-specific behavior to avoid "Lingering" on Desktop
        // but keep "Smooth Transition" on Mobile.
        if (Platform.isDesktop) {
          this.close();

          // Use multi-select for Calibre
          if (service.value === "calibre") {
            this.plugin
              .createMultipleCalibreNotes()
              .catch((err) => console.warn(err));
          } else {
            this.plugin
              .createNewBookNote(service.value)
              .catch((err) => console.warn(err));
          }
          return;
        }

        // Mobile Logic: Persistent Backdrop & Smooth Animation
        // 1. Start slide-down animation
        const closePromise = this.animateClose();

        // 2. Wait a tiny bit to let animation start smoothly
        await new Promise((resolve) => setTimeout(resolve, 50));

        // 3. Trigger next modal overlapping with animation
        try {
          await new Promise<void>((resolve, reject) => {
            setTimeout(() => {
              // Use multi-select for Calibre
              const action =
                service.value === "calibre"
                  ? this.plugin.createMultipleCalibreNotes()
                  : this.plugin.createNewBookNote(service.value);

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
