import { ServiceProvider } from "@src/constants";
import BookSearchPlugin from "@src/main";
import { Modal, Setting } from "obsidian";

export class SettingServiceProviderModal extends Modal {
  private readonly plugin: BookSearchPlugin;
  private readonly currentServiceProvider: ServiceProvider;

  constructor(
    plugin: BookSearchPlugin,
    private callback?: () => void,
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.currentServiceProvider =
      plugin.settings?.serviceProvider ?? ServiceProvider.google;
  }

  get settings() {
    return this.plugin.settings;
  }

  async saveSetting() {
    return this.plugin.saveSettings();
  }

  saveCalibreServerUrl(url: string) {
    if (this.currentServiceProvider === ServiceProvider.calibre) {
      // Remove trailing slash if present
      this.plugin.settings.calibreServerUrl = url.replace(/\/$/, "");
    }
  }

  get currentCalibreServerUrl() {
    if (this.currentServiceProvider === ServiceProvider.calibre) {
      return this.settings.calibreServerUrl;
    }
    return "";
  }

  get currentClientSecret() {
    return "";
  }
  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Service provider setting" });

    if (this.currentServiceProvider === ServiceProvider.calibre) {
      new Setting(contentEl)
        .setName("Calibre server URL")
        .setDesc("e.g. http://192.168.1.50:8080")
        .addText((text) => {
          text
            .setValue(this.currentCalibreServerUrl)
            .onChange((value) => this.saveCalibreServerUrl(value));
        });
    }

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          void (async () => {
            await this.plugin.saveSettings();
            this.close();
            this.callback?.();
          })();
        }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
