import { App, TFile, requestUrl, Notice } from "obsidian";
import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import {
  useTemplaterPluginInFile,
  getTemplateContents,
  applyTemplateTransformations,
  executeInlineScriptsTemplates,
} from "@utils/template";
import {
  makeFileName,
  applyDefaultFrontMatter,
  replaceVariableSyntax,
  toStringFrontMatter,
  parseFrontMatter,
  createBookTags,
} from "@utils/utils";

export class BookNoteCreator {
  constructor(
    private app: App,
    private settings: BookSearchPluginSettings,
  ) {}

  async create(book: Book): Promise<TFile> {
    const renderedContents = await this.getRenderedContents(book);
    const fileName = makeFileName(book, this.settings.fileNameFormat);

    if (this.settings.folder) {
      await this.ensureFolderExists(this.settings.folder);
    }

    const filePath = this.settings.folder
      ? `${this.settings.folder}/${fileName}`
      : fileName;

    const targetFile = await this.app.vault.create(filePath, renderedContents);
    await useTemplaterPluginInFile(this.app, targetFile);
    return targetFile;
  }

  async getRenderedContents(book: Book): Promise<string> {
    let { frontmatter, content } = this.settings;

    // Generate tags automatically
    book.tags = createBookTags(
      book,
      this.settings.authorTagPrefix,
      this.settings.titleTagPrefix,
    );

    // Handle cover image
    const coverImageUrl = book.coverSmallUrl || book.coverUrl;
    if (this.settings.enableCoverImageSave && coverImageUrl) {
      const imageName = this.sanitizeImageName(book);
      const directory = this.settings.coverImagePath;
      const localCoverImage = await this.downloadAndSaveImage(
        imageName,
        directory,
        coverImageUrl,
      );
      book.localCoverImage = localCoverImage;
    }

    if (this.settings.templateFile) {
      const templateContent = await getTemplateContents(
        this.app,
        this.settings.templateFile,
      );
      if (templateContent) {
        // Handle Date/Time variables in the template
        const transformedTemplate =
          applyTemplateTransformations(templateContent);

        const splitContent = transformedTemplate.split("---");
        if (splitContent.length >= 3) {
          frontmatter = splitContent[1];
          content = splitContent.slice(2).join("---");
        } else {
          content = transformedTemplate;
        }
      }
    }

    let formattedFrontmatter =
      typeof frontmatter === "string"
        ? parseFrontMatter(frontmatter)
        : frontmatter;

    if (this.settings.useDefaultFrontmatter) {
      formattedFrontmatter = applyDefaultFrontMatter(
        book,
        formattedFrontmatter,
        this.settings.defaultFrontmatterKeyType,
      );
    }

    // 1. Replace variables in each value of the frontmatter object first
    // This allows the quoting logic to see the actual book data (description, etc.)
    const resolvedFrontmatter = {};
    for (const [key, value] of Object.entries(formattedFrontmatter)) {
      if (typeof value === "string") {
        resolvedFrontmatter[key] = replaceVariableSyntax(book, value);
      } else if (Array.isArray(value)) {
        resolvedFrontmatter[key] = value.map((v) =>
          typeof v === "string" ? replaceVariableSyntax(book, v) : v,
        );
      } else {
        resolvedFrontmatter[key] = value;
      }
    }

    // 2. Now stringify the resolved frontmatter (this applies the guillemet logic)
    const cleanFrontmatter = toStringFrontMatter(resolvedFrontmatter);
    const replacedVariableContent = replaceVariableSyntax(book, content);

    const fullContent = cleanFrontmatter
      ? `---\n${cleanFrontmatter}\n---\n${replacedVariableContent}`
      : replacedVariableContent;

    // Apply inline scripts templates <% %>
    return executeInlineScriptsTemplates(book, fullContent);
  }

  private async downloadAndSaveImage(
    imageName: string,
    directory: string,
    imageUrl: string,
  ): Promise<string> {
    try {
      const response = await requestUrl({
        url: imageUrl,
        method: "GET",
        headers: {
          Accept: "image/*",
        },
      });

      if (response.status !== 200) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      const imageData = response.arrayBuffer;
      if (directory) {
        await this.ensureFolderExists(directory);
      }
      const filePath = directory ? `${directory}/${imageName}` : imageName;
      await this.app.vault.adapter.writeBinary(filePath, imageData);
      return `[[${filePath}]]`;
    } catch (error) {
      console.error("Error downloading or saving image:", error);
      return "";
    }
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (!folderPath) return;
    const folders = folderPath.split("/");
    let currentPath = "";
    for (const folder of folders) {
      currentPath += (currentPath ? "/" : "") + folder;
      if (!(await this.app.vault.adapter.exists(currentPath))) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private sanitizeImageName(book: Book): string {
    const raw = `${book.title} — ${book.author}`;
    const sanitized = raw
      .replace(/[:/\\?%*|"<>#[]()]/g, "") // Thoroughly sanitize for Obsidian and OS
      .replace(/\s+/g, " ")
      .trim();
    // Truncate to 200 chars to leave room for extension and path
    return sanitized.slice(0, 200) + ".jpg";
  }
}
