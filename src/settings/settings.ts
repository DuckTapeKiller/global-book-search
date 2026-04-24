import { replaceDateInString } from "@utils/utils";
import { App, Menu, Notice, PluginSettingTab, Setting } from "obsidian";

import { ServiceProvider } from "@src/constants";
import languages from "@utils/languages";
import { SettingServiceProviderModal } from "@views/setting_service_provider_modal";
import BookSearchPlugin from "../main";
import { FileNameFormatSuggest } from "./suggesters/FileNameFormatSuggester";
import { FileSuggest } from "./suggesters/FileSuggester";
import { FolderSuggest } from "./suggesters/FolderSuggester";

const docUrl = "https://github.com/anpigon/obsidian-book-search-plugin";

export enum DefaultFrontmatterKeyType {
  snakeCase = "Snake Case",
  camelCase = "Camel Case",
}

export interface BookSearchPluginSettings {
  folder: string; // new file location
  fileNameFormat: string; // new file name format
  frontmatter: string; // frontmatter that is inserted into the file
  content: string; // what is automatically written to the file.
  useDefaultFrontmatter: boolean;
  defaultFrontmatterKeyType: DefaultFrontmatterKeyType;
  templateFile: string;
  serviceProvider: ServiceProvider;
  localePreference: string;
  apiKey: string;
  openPageOnCompletion: boolean;
  showCoverImageInSearch: boolean;
  enableCoverImageSave: boolean;
  enableCoverImageEdgeCurl: boolean;
  coverImagePath: string;
  askForLocale: boolean;
  calibreServerUrl: string;
  calibreLibraryId: string;

  // New features
  warnOnDuplicate: boolean; // Warn if book note already exists
  searchHistory: string[]; // Last 10 searches
  maxSearchHistory: number; // How many to keep
  enableSeriesLinking: boolean; // Add series links automatically
  showTemplatePreview: boolean; // Preview note before creation
}

export const FRONTMATTER_TEMPLATES = {
  Spanish: `---
Título: {{title}}
Título original: {{originalTitle}}
Autor: {{author}}
Traductor: {{translator}}
Prólogo: ""
Resumen: "{{description}}"
Páginas: {{totalPage}}
Editorial: {{publisher}}
Géneros: {{categories}}
Isbn 10: {{isbn10}}
Isbn 13: {{isbn13}}
ASIN: {{asin}}
Fecha de publicación: {{publishDate}}
Fecha de lectura: 
Portada: "{{localCoverImage}}"
Enlace: {{link}}
tags: {{tags}}
Leído: false
---`,
  English: `---
Title: {{title}}
Original title: {{originalTitle}}
Author: {{author}}
Translator: {{translator}}
Prologue: ""
Description: "{{description}}"
Total Pages: {{totalPage}}
Publisher: {{publisher}}
Categories: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Published: {{publishDate}}
Date read:
Cover: "{{localCoverImage}}"
Link: {{link}}
Tags: {{tags}}
Read: false
---`,
  French: `---
Titre: {{title}}
Titre original: {{originalTitle}}
Auteur: {{author}}
Traducteur: {{translator}}
Prologue: ""
Description: "{{description}}"
Nombre total de pages: {{totalPage}}
Éditeur: {{publisher}}
Catégories: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Publié: {{publishDate}}
Date de lecture: 
Couverture: "{{localCoverImage}}"
Lien: {{link}}
tags: {{tags}}
Lu: false
---`,
  German: `---
Titel: {{title}}
Originaltitel: {{originalTitle}}
Autor: {{author}}
Übersetzer: {{translator}}
Prolog: ""
Beschreibung: "{{description}}"
Gesamtseitenzahl: {{totalPage}}
Verlag: {{publisher}}
Kategorien: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Veröffentlicht: {{publishDate}}
Lesedatum: 
Cover: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Gelesen: false
---`,
  Italian: `---
Titolo: {{title}}
Titolo originale: {{originalTitle}}
Autore: {{author}}
Traduttore: {{translator}}
Prologo: ""
Descrizione: "{{description}}"
Pagine totali: {{totalPage}}
Editore: {{publisher}}
Categorie: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Pubblicato: {{publishDate}}
Data di lettura: 
Copertina: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Letto: false
---`,
  Portuguese: `---
Título: {{title}}
Título original: {{originalTitle}}
Autor: {{author}}
Tradutor: {{translator}}
Prólogo: ""
Descrição: "{{description}}"
Total de páginas: {{totalPage}}
Editora: {{publisher}}
Categorias: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Publicado: {{publishDate}}
Data de leitura: 
Capa: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Lido: false
---`,
  Dutch: `---
Titel: {{title}}
Oorspronkelijke titel: {{originalTitle}}
Auteur: {{author}}
Vertaler: {{translator}}
Proloog: ""
Beschrijving: "{{description}}"
Totaal aantal pagina's: {{totalPage}}
Uitgever: {{publisher}}
Categorieën: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Gepubliceerd: {{publishDate}}
Gelezen op: 
Omslag: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Gelezen: false
---`,
  Russian: `---
Название: {{title}}
Оригинальное название: {{originalTitle}}
Автор: {{author}}
Переводчик: {{translator}}
Пролог: ""
Описание: "{{description}}"
Всего страниц: {{totalPage}}
Издатель: {{publisher}}
Категории: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
Опубликовано: {{publishDate}}
Дата прочтения: 
Обложка: "{{localCoverImage}}"
Ссылка: {{link}}
tags: {{tags}}
Прочитано: false
---`,
  "Simplified Chinese": `---
标题: {{title}}
原标题: {{originalTitle}}
作者: {{author}}
译者: {{translator}}
序言: ""
描述: "{{description}}"
总页数: {{totalPage}}
出版社: {{publisher}}
分类: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
出版日期: {{publishDate}}
阅读日期: 
封面: "{{localCoverImage}}"
链接: {{link}}
tags: {{tags}}
已读: false
---`,
  Japanese: `---
タイトル: {{title}}
原題: {{originalTitle}}
著者: {{author}}
翻訳者: {{translator}}
プロローグ: ""
説明: "{{description}}"
総ページ数: {{totalPage}}
出版社: {{publisher}}
カテゴリ: {{categories}}
Isbn10: {{isbn10}}
Isbn13: {{isbn13}}
Asin: {{asin}}
出版日: {{publishDate}}
読了日: 
表紙: "{{localCoverImage}}"
リンク: {{link}}
tags: {{tags}}
読了: false
---`,
  Korean: `---
제목: {{title}}
원제: {{originalTitle}}
저자: {{author}}
번역가: {{translator}}
프롤로그: ""
설명: "{{description}}"
총 페이지 수: {{totalPage}}
출판사: "{{publisher}}"
카테고리: "{{categories}}"
Isbn10: "{{isbn10}}"
Isbn13: "{{isbn13}}"
Asin: "{{asin}}"
출판일: "{{publishDate}}"
읽은 날짜: 
표지: "{{localCoverImage}}"
링크: "{{link}}"
tags: {{tags}}
읽음: false
---`,
};

export const DEFAULT_SETTINGS: BookSearchPluginSettings = {
  folder: "",
  fileNameFormat: "{{title}} - {{author}}",
  frontmatter: FRONTMATTER_TEMPLATES.Spanish,
  content: "",
  useDefaultFrontmatter: false,
  defaultFrontmatterKeyType: DefaultFrontmatterKeyType.camelCase,
  templateFile: "",
  serviceProvider: ServiceProvider.google,
  localePreference: "default",
  apiKey: "",
  openPageOnCompletion: true,
  showCoverImageInSearch: true,
  enableCoverImageSave: false,
  enableCoverImageEdgeCurl: true,
  coverImagePath: "",
  askForLocale: true,
  calibreServerUrl: "http://localhost:8080",
  calibreLibraryId: "calibre",

  // New features defaults
  warnOnDuplicate: true,
  searchHistory: [],
  maxSearchHistory: 10,
  enableSeriesLinking: true,
  showTemplatePreview: false,
};

export class BookSearchSettingTab extends PluginSettingTab {
  private serviceProviderExtraSettingButton: HTMLElement | null = null;
  private preferredLocaleDropdownSetting: Setting | null = null;
  private coverImageEdgeCurlToggleSetting: Setting | null = null;
  private calibreServerUrlSetting: Setting | null = null;
  private calibreLibraryIdSetting: Setting | null = null;
  private calibreSettingsHeader: Setting | null = null;

  constructor(
    app: App,
    private plugin: BookSearchPlugin,
  ) {
    super(app, plugin);
  }

  private createGeneralSettings(containerEl) {
    this.createHeader("General settings", containerEl);
    this.createFileLocationSetting(containerEl);
    this.createFileNameFormatSetting(containerEl);
  }

  private createHeader(title: string, containerEl: HTMLElement) {
    const setting = new Setting(containerEl).setHeading().setName(title);
    setting.settingEl.addClass("book-search-plugin__header");
    return setting;
  }

  private createFileLocationSetting(containerEl) {
    new Setting(containerEl)
      .setName("New file location")
      .setDesc("New book notes will be placed here.")
      .addSearch((cb) => {
        try {
          new FolderSuggest(this.app, cb.inputEl);
        } catch (e) {
          console.error(e); // Improved error handling
        }
        cb.setPlaceholder("Example: folder1/folder2")
          .setValue(this.plugin.settings.folder)
          .onChange((new_folder) => {
            this.plugin.settings.folder = new_folder;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createFileNameFormatSetting(containerEl) {
    const desc = document.createDocumentFragment();
    desc.createSpan({ text: "Enter the file name format. Example: " });
    const newFileNameHint = desc.createEl("code", {
      text:
        replaceDateInString(this.plugin.settings.fileNameFormat) ||
        "{{title}} - {{author}}",
    });

    new Setting(containerEl)
      .setClass("book-search-plugin__settings--new_file_name")
      .setName("New file name")
      .setDesc(desc)
      .addSearch((cb) => {
        try {
          new FileNameFormatSuggest(this.app, cb.inputEl);
        } catch (e) {
          console.error(e);
        }
        cb.setPlaceholder("Example: {{title}} - {{author}}")
          .setValue(this.plugin.settings.fileNameFormat)
          .onChange((newValue) => {
            this.plugin.settings.fileNameFormat = newValue?.trim();
            void this.plugin.saveSettings().catch((err) => console.warn(err));

            newFileNameHint.textContent =
              replaceDateInString(newValue) || "{{title}} - {{author}}";
          });
      });
  }

  private createFrontmatterSetting(containerEl: HTMLElement) {
    const desc = document.createDocumentFragment();
    desc.createDiv({ text: "The frontmatter that is inserted into the text." });

    const buttonContainer = desc.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.marginTop = "8px";

    const restoreButton = buttonContainer.createEl("button", {
      text: "Restore default",
      cls: "mod-warning",
    });
    restoreButton.onclick = () => {
      this.plugin.settings.frontmatter = DEFAULT_SETTINGS.frontmatter;
      void this.plugin.saveSettings().then(() => this.display());
    };

    const languagesButton = buttonContainer.createEl("button", {
      text: "Languages",
    });
    languagesButton.onclick = (event: MouseEvent) => {
      const menu = new Menu();
      Object.keys(FRONTMATTER_TEMPLATES).forEach((lang) => {
        menu.addItem((item) => {
          item.setTitle(lang).onClick(() => {
            this.plugin.settings.frontmatter =
              FRONTMATTER_TEMPLATES[lang as keyof typeof FRONTMATTER_TEMPLATES];
            void this.plugin.saveSettings().then(() => this.display());
          });
        });
      });
      menu.showAtMouseEvent(event);
    };

    new Setting(containerEl)
      .setName("Frontmatter")
      .setDesc(desc)
      .addTextArea((text) => {
        text.inputEl.rows = 15;
        text.inputEl.cols = 40;
        text.inputEl.addClass("book-search-plugin__settings--textarea");
        text
          .setPlaceholder("Enter the frontmatter")
          .setValue(this.plugin.settings.frontmatter)
          .onChange((newValue) => {
            this.plugin.settings.frontmatter = newValue;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createContentSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Content")
      .setDesc(
        "This content is automatically added to every new book note after the frontmatter. Use it to include default headings (e.g., # Thoughts), reading logs, or inline scripts for further customization.",
      )
      .addTextArea((text) => {
        text.inputEl.rows = 10;
        text.inputEl.cols = 40;
        text.inputEl.addClass("book-search-plugin__settings--textarea");
        text
          .setPlaceholder("Enter the content")
          .setValue(this.plugin.settings.content)
          .onChange((newValue) => {
            this.plugin.settings.content = newValue;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createCoverImageSaveSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Enable cover image save")
      .setDesc("Toggle to enable or disable saving cover images in notes.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCoverImageSave)
          .onChange((value) => {
            this.plugin.settings.enableCoverImageSave = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createCoverImagePathSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Cover image path")
      .setDesc("Specify the path where cover images should be saved.")
      .addSearch((cb) => {
        try {
          new FolderSuggest(this.app, cb.inputEl);
        } catch {
          // eslint-disable
        }
        cb.setPlaceholder("Enter the path (e.g., Images/Covers)")
          .setValue(this.plugin.settings.coverImagePath)
          .onChange((value) => {
            this.plugin.settings.coverImagePath = value.trim();
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  private createShowTemplatePreviewSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Show template preview")
      .setDesc("Preview the rendered note before creating it.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTemplatePreview)
          .onChange((value) => {
            this.plugin.settings.showTemplatePreview = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createServiceProviderSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Service provider")
      .setDesc(
        "Choose the service provider you want to use to search your books.",
      )
      .setClass("book-search-plugin__settings--service_provider")
      .addDropdown((dropDown) => {
        dropDown.addOption(
          ServiceProvider.google,
          `${ServiceProvider.google} (Global)`,
        );
        dropDown.addOption(
          ServiceProvider.goodreads,
          `${ServiceProvider.goodreads} (Scraping)`,
        );
        dropDown.addOption(
          ServiceProvider.calibre,
          `${ServiceProvider.calibre} (Local Server)`,
        );
        dropDown.addOption(
          ServiceProvider.openlibrary,
          `${ServiceProvider.openlibrary} (Public API)`,
        );
        dropDown.setValue(
          this.plugin.settings?.serviceProvider ?? ServiceProvider.google,
        );
        dropDown.onChange((value) => {
          const newValue = value as ServiceProvider;
          this.toggleServiceProviderExtraSettings(newValue);
          this.plugin.settings["serviceProvider"] = newValue;
          void this.plugin.saveSettings().catch((err) => console.warn(err));
        });
      })
      .addExtraButton((component) => {
        this.serviceProviderExtraSettingButton = component.extraSettingsEl;
        component.onClick(() => {
          new SettingServiceProviderModal(this.plugin).open();
        });
      });

    this.calibreSettingsHeader = this.createHeader(
      "Calibre settings",
      containerEl,
    );

    this.calibreServerUrlSetting = new Setting(containerEl)
      .setName("Calibre server URL")
      .setDesc("Enter the URL of your Calibre content server.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:8080")
          .setValue(this.plugin.settings.calibreServerUrl)
          .onChange((value) => {
            this.plugin.settings.calibreServerUrl = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );

    this.calibreLibraryIdSetting = new Setting(containerEl)
      .setName("Calibre library ID")
      .setDesc(
        "Enter the library ID (default: calibre). This is usually the folder name of your library.",
      )
      .addText((text) =>
        text
          .setPlaceholder("calibre")
          .setValue(this.plugin.settings.calibreLibraryId)
          .onChange((value) => {
            this.plugin.settings.calibreLibraryId = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );

    this.preferredLocaleDropdownSetting = new Setting(containerEl)
      .setName("Preferred locale")
      .setDesc("Sets the preferred locale to use when searching for books.")
      .addDropdown((dropDown) => {
        const defaultLocale = window.moment.locale();
        dropDown.addOption(
          defaultLocale,
          `${languages[defaultLocale] || defaultLocale} (Default Locale)`,
        );
        Object.keys(languages).forEach((locale) => {
          const localeName = languages[locale];
          if (localeName && locale !== defaultLocale)
            dropDown.addOption(locale, localeName);
        });
        const localeValue = this.plugin.settings.localePreference;
        dropDown
          .setValue(
            localeValue === DEFAULT_SETTINGS.localePreference
              ? defaultLocale
              : localeValue,
          )
          .onChange((value) => {
            const newValue = value;
            this.plugin.settings.localePreference = newValue;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });

    new Setting(containerEl)
      .setName("Open new book note")
      .setDesc(
        "Enable or disable the automatic opening of the note on creation.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openPageOnCompletion)
          .onChange((value) => {
            this.plugin.settings.openPageOnCompletion = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );

    this.coverImageEdgeCurlToggleSetting = new Setting(containerEl)
      .setName("Enable cover image edge curl effect")
      .setDesc("Toggle to show or hide page curl effect in cover images.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCoverImageEdgeCurl)
          .onChange((value) => {
            this.plugin.settings.enableCoverImageEdgeCurl = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );

    // A toggle whether or not to ask for the locale every time a search is made
    new Setting(containerEl)
      .setName("Ask for locale")
      .setDesc(
        "Toggle to enable or disable asking for the locale every time a search is made.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.askForLocale).onChange((value) => {
          this.plugin.settings.askForLocale = value;
          void this.plugin.saveSettings().catch((err) => console.warn(err));
        }),
      );
  }

  private createShowCoverImageInSearchSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Show cover images in search")
      .setDesc("Toggle to show or hide cover images in the search results.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCoverImageInSearch)
          .onChange((value) => {
            this.plugin.settings.showCoverImageInSearch = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createGoogleApiSettings(containerEl: HTMLElement) {
    const googleDesc = document.createDocumentFragment();
    googleDesc.createEl("div", {
      text: "If you get 'Request Failed, status 429', it means you have reached the daily limit of the shared API key.",
    });
    googleDesc.createEl("div", {
      text: "Please create your own Google Books API key at ",
    });
    googleDesc.createEl("a", {
      text: "Google Cloud Console",
      href: "https://console.cloud.google.com/apis/credentials",
    });
    googleDesc.createEl("span", { text: " and paste it below." });

    new Setting(containerEl).setName("Google API settings").setDesc(googleDesc);

    new Setting(containerEl)
      .setName("Status check")
      .setDesc(
        "Check whether API key is saved. It does not guarantee that the API key is valid or invalid.",
      )
      .addButton((button) => {
        button.setButtonText("API check").onClick(() => {
          if (this.plugin.settings.apiKey.length) {
            new Notice("API key exists.");
          } else {
            new Notice("API key does not exist.");
          }
        });
      });

    const googleAPISetDesc = document.createDocumentFragment();
    googleAPISetDesc.createDiv({ text: "Set your Books API key." });
    googleAPISetDesc.createDiv({
      text: "For security reason, saved API key is not shown in this textarea after saved.",
    });
    let tempKeyValue = "";
    new Setting(containerEl)
      .setName("Set API key")
      .setDesc(googleAPISetDesc)
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue("").onChange((value) => {
          tempKeyValue = value;
        });
      })
      .addButton((button) => {
        button.setButtonText("Save key").onClick(() => {
          this.plugin.settings.apiKey = tempKeyValue;
          void this.plugin
            .saveSettings()
            .then(() => new Notice("API key saved"));
        });
      });
  }

  private createWarnOnDuplicateSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Warn on duplicate")
      .setDesc(
        "Show a warning before creating a note if one already exists for this book.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.warnOnDuplicate)
          .onChange((value) => {
            this.plugin.settings.warnOnDuplicate = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createEnableSeriesLinkingSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Enable series linking")
      .setDesc(
        "Automatically add series information and links (e.g., [[Series Name]]) to book notes.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSeriesLinking)
          .onChange((value) => {
            this.plugin.settings.enableSeriesLinking = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createSearchHistorySizeSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Search history size")
      .setDesc("Number of recent searches to remember (0 to disable).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.maxSearchHistory)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.maxSearchHistory = value;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          }),
      );
  }

  private createClearSearchHistorySetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Clear search history")
      .setDesc(
        `Currently storing ${this.plugin.settings.searchHistory?.length || 0} search(es).`,
      )
      .addButton((button) =>
        button.setButtonText("Clear").onClick(() => {
          this.plugin.settings.searchHistory = [];
          void this.plugin.saveSettings().then(() => {
            new Notice("Search history cleared");
            // Refresh to update count
            this.display();
          });
        }),
      );
  }

  private toggleServiceProviderExtraSettings(
    serviceProvider: ServiceProvider = this.plugin.settings?.serviceProvider,
  ) {
    if (serviceProvider === ServiceProvider.goodreads) {
      this.hideServiceProviderExtraSettingButton();
      this.showServiceProviderExtraSettingDropdown();
      this.showCoverImageEdgeCurlToggle();
      this.hideCalibreSettings();
    } else if (serviceProvider === ServiceProvider.calibre) {
      this.showServiceProviderExtraSettingButton();
      this.hideServiceProviderExtraSettingDropdown();
      this.hideCoverImageEdgeCurlToggle();
      this.showCalibreSettings();
    } else if (serviceProvider === ServiceProvider.openlibrary) {
      this.hideServiceProviderExtraSettingButton();
      this.showServiceProviderExtraSettingDropdown();
      this.showCoverImageEdgeCurlToggle();
      this.hideCalibreSettings();
    } else {
      this.hideServiceProviderExtraSettingButton();
      this.showServiceProviderExtraSettingDropdown();
      this.showCoverImageEdgeCurlToggle();
      this.hideCalibreSettings();
    }
  }

  private hideServiceProviderExtraSettingButton() {
    if (this.serviceProviderExtraSettingButton !== null)
      this.serviceProviderExtraSettingButton.addClass(
        "book-search-plugin__hide",
      );
  }
  private showServiceProviderExtraSettingButton() {
    if (this.serviceProviderExtraSettingButton !== null)
      this.serviceProviderExtraSettingButton.removeClass(
        "book-search-plugin__hide",
      );
  }
  private hideServiceProviderExtraSettingDropdown() {
    if (this.preferredLocaleDropdownSetting !== null)
      this.preferredLocaleDropdownSetting.settingEl.addClass(
        "book-search-plugin__hide",
      );
  }
  private showServiceProviderExtraSettingDropdown() {
    if (this.preferredLocaleDropdownSetting !== null)
      this.preferredLocaleDropdownSetting.settingEl.removeClass(
        "book-search-plugin__hide",
      );
  }
  private hideCoverImageEdgeCurlToggle() {
    if (this.coverImageEdgeCurlToggleSetting !== null)
      this.coverImageEdgeCurlToggleSetting.settingEl.addClass(
        "book-search-plugin__hide",
      );
  }
  private showCoverImageEdgeCurlToggle() {
    if (this.coverImageEdgeCurlToggleSetting !== null)
      this.coverImageEdgeCurlToggleSetting.settingEl.removeClass(
        "book-search-plugin__hide",
      );
  }
  private showCalibreSettings() {
    if (this.calibreServerUrlSetting !== null)
      this.calibreServerUrlSetting.settingEl.removeClass(
        "book-search-plugin__hide",
      );
    if (this.calibreLibraryIdSetting !== null)
      this.calibreLibraryIdSetting.settingEl.removeClass(
        "book-search-plugin__hide",
      );
    if (this.calibreSettingsHeader !== null)
      this.calibreSettingsHeader.settingEl.removeClass(
        "book-search-plugin__hide",
      );
  }
  private hideCalibreSettings() {
    if (this.calibreServerUrlSetting !== null)
      this.calibreServerUrlSetting.settingEl.addClass(
        "book-search-plugin__hide",
      );
    if (this.calibreLibraryIdSetting !== null)
      this.calibreLibraryIdSetting.settingEl.addClass(
        "book-search-plugin__hide",
      );
    if (this.calibreSettingsHeader !== null)
      this.calibreSettingsHeader.settingEl.addClass("book-search-plugin__hide");
  }

  private createTemplateFileSetting(containerEl: HTMLElement) {
    const templateFileDesc = document.createDocumentFragment();
    templateFileDesc.createDiv({
      text: "Files will be available as templates.",
    });
    templateFileDesc.createEl("a", {
      text: "Example template",
      href: `${docUrl}#example-template`,
    });
    new Setting(containerEl)
      .setName("Template file")
      .setDesc(templateFileDesc)
      .addSearch((cb) => {
        try {
          new FileSuggest(this.app, cb.inputEl);
        } catch {
          // ignore
        }
        cb.setPlaceholder("Example: templates/template-file")
          .setValue(this.plugin.settings.templateFile)
          .onChange((newTemplateFile) => {
            this.plugin.settings.templateFile = newTemplateFile;
            void this.plugin.saveSettings().catch((err) => console.warn(err));
          });
      });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.classList.add("book-search-plugin__settings");

    this.createHeader("General settings", containerEl);

    this.createHeader("Book notes", containerEl);
    this.createFileLocationSetting(containerEl);
    this.createFileNameFormatSetting(containerEl);
    this.createFrontmatterSetting(containerEl);
    this.createTemplateFileSetting(containerEl);
    this.createContentSetting(containerEl);
    this.createCoverImageSaveSetting(containerEl);
    this.createCoverImagePathSetting(containerEl);
    this.createShowTemplatePreviewSetting(containerEl);

    this.createHeader("Provider", containerEl);
    this.createServiceProviderSetting(containerEl);
    this.createShowCoverImageInSearchSetting(containerEl);
    this.createGoogleApiSettings(containerEl);

    this.createHeader("Advanced features", containerEl);
    this.createWarnOnDuplicateSetting(containerEl);
    this.createEnableSeriesLinkingSetting(containerEl);
    this.createSearchHistorySizeSetting(containerEl);
    this.createClearSearchHistorySetting(containerEl);

    // Initialize visibility
    this.toggleServiceProviderExtraSettings();
  }
}
