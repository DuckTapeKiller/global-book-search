import { App, TFile } from "obsidian";
import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { httpRequest } from "@utils/http";
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
  splitListValue,
  LIST_VALUE_KEYS,
} from "@utils/utils";

/**
 * Read a list-shaped book field (e.g. `categories`) as a list.
 *
 * Array values are always accepted. Comma-separated strings are only split when
 * `commaSeparated` is set, so a single-sentence `description` is never mistaken
 * for a list. Returns `undefined` when the field is empty or a plain scalar, so
 * callers fall back to normal variable substitution.
 */
function listValueForBookField(
  book: Book,
  fieldName: string,
  { commaSeparated = true }: { commaSeparated?: boolean } = {},
): string[] | undefined {
  const raw = (book as unknown as Record<string, unknown>)[fieldName];
  const items = Array.isArray(raw)
    ? raw.map((item) => String(item ?? "").trim()).filter(Boolean)
    : commaSeparated && typeof raw === "string"
      ? splitListValue(raw)
      : [];
  return items.length > 0 ? items : undefined;
}

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
    const resolvedFrontmatter = await this.getResolvedFrontmatter(book);
    const cleanFrontmatter = toStringFrontMatter(resolvedFrontmatter);

    let content = this.settings.content;
    if (this.settings.templateFile) {
      const templateContent = await getTemplateContents(
        this.app,
        this.settings.templateFile,
      );
      if (templateContent) {
        const transformedTemplate =
          applyTemplateTransformations(templateContent);
        const splitContent = transformedTemplate.split("---");
        if (splitContent.length >= 3) {
          content = splitContent.slice(2).join("---");
        } else {
          content = transformedTemplate;
        }
      }
    }

    // Security: execute inline scripts only on the *template text* (before variables
    // are substituted). This prevents remote metadata values (e.g. description) from
    // injecting `<%=` blocks that would otherwise be executed.
    const scriptedContent = executeInlineScriptsTemplates(book, content);
    const replacedVariableContent = replaceVariableSyntax(
      book,
      scriptedContent,
    );

    const fullContent = cleanFrontmatter
      ? `---\n${cleanFrontmatter}\n---\n${replacedVariableContent}`
      : replacedVariableContent;

    return fullContent;
  }

  async updateMetadata(file: TFile, book: Book): Promise<void> {
    const resolvedFrontmatter = await this.getResolvedFrontmatter(book);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      Object.assign(fm, resolvedFrontmatter);
    });
  }

  async getResolvedFrontmatter(book: Book): Promise<Record<string, unknown>> {
    let { frontmatter } = this.settings;

    // Generate tags automatically
    book.tags = createBookTags(
      book,
      this.settings.authorTagPrefix,
      this.settings.titleTagPrefix,
    );

    // Handle cover image
    const coverImageUrl = (book.coverUrl || book.coverSmallUrl || "").trim();
    const coverMode = this.settings.coverImageMode || "none";

    if (coverMode === "none") {
      book.localCoverImage = "";
    } else if (coverMode === "remote") {
      book.localCoverImage = coverImageUrl;
    } else if (coverMode === "local" && coverImageUrl) {
      const baseName = this.sanitizeImageBaseName(book);
      const directory = this.settings.coverImagePath;
      const localCoverImage = await this.downloadAndSaveImage(
        baseName,
        directory,
        coverImageUrl,
        this.settings.coverImageFileExtension,
      );

      // If the download fails, fallback to a remote URL so the note still has a cover reference.
      book.localCoverImage = localCoverImage || coverImageUrl;
    }

    if (this.settings.templateFile) {
      const templateContent = await getTemplateContents(
        this.app,
        this.settings.templateFile,
      );
      if (templateContent) {
        const transformedTemplate =
          applyTemplateTransformations(templateContent);
        const splitContent = transformedTemplate.split("---");
        if (splitContent.length >= 3) {
          frontmatter = splitContent[1];
        }
      }
    }

    // Same security rule as note content: evaluate inline scripts only on the
    // template frontmatter text, never on substituted metadata values.
    if (typeof frontmatter === "string" && frontmatter.includes("<%=")) {
      frontmatter = executeInlineScriptsTemplates(book, frontmatter);
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

    const resolvedFrontmatter: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formattedFrontmatter)) {
      if (typeof value === "string") {
        // A value that is exactly one variable (`{{tags}}`, `"{{categories}}"`,
        // quotes are stripped while parsing) must keep its list shape so it
        // serialises as a YAML block sequence (dash-separated entries) instead of
        // one flat comma-joined sentence. List-shaped keys are converted from the
        // providers' `"a, b, c"` strings into a real list; other fields keep the
        // previous behaviour (array-valued fields stay arrays, scalars stay flat).
        const trimmed = value.trim();
        const variable = trimmed.match(/^(['"]?){{\s*(\w+)\s*}}\1$/);
        if (variable) {
          const fieldName = variable[2];
          const listValue = LIST_VALUE_KEYS.has(fieldName.toLowerCase())
            ? listValueForBookField(book, fieldName)
            : listValueForBookField(book, fieldName, { commaSeparated: false });
          if (listValue) {
            resolvedFrontmatter[key] = listValue;
            continue;
          }
        }

        resolvedFrontmatter[key] = replaceVariableSyntax(book, value);
      } else if (Array.isArray(value)) {
        resolvedFrontmatter[key] = (value as unknown[]).map((v) =>
          typeof v === "string" ? replaceVariableSyntax(book, v) : v,
        );
      } else {
        resolvedFrontmatter[key] = value;
      }
    }
    return resolvedFrontmatter;
  }

  private async downloadAndSaveImage(
    baseName: string,
    directory: string,
    imageUrl: string,
    preferredExtension: "jpg" | "png" | "webp",
  ): Promise<string> {
    try {
      const response = await httpRequest(
        {
          url: imageUrl,
          method: "GET",
          headers: {
            Accept: "image/*",
          },
        },
        {
          providerId: "cover",
          purpose: "download",
          responseType: "arrayBuffer",
          bypassCache: true,
        },
      );

      if (response.status !== 200) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      const ext = this.detectImageExtension(
        response.headers || {},
        imageUrl,
        preferredExtension,
      );
      const imageName = `${baseName}.${ext}`;

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

  private detectImageExtension(
    headers: Record<string, string>,
    url: string,
    fallback: "jpg" | "png" | "webp",
  ): "jpg" | "png" | "webp" {
    const contentType =
      headers["content-type"] || headers["Content-Type"] || "";
    const ct = contentType.toLowerCase();
    if (ct.includes("image/webp")) return "webp";
    if (ct.includes("image/png")) return "png";
    if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpg";

    // URL hint (best-effort).
    const match = (url || "").toLowerCase().match(/\.(jpe?g|png|webp)(?:$|\?)/);
    if (match?.[1]) {
      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      if (ext === "jpg" || ext === "png" || ext === "webp") return ext;
    }

    return fallback;
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

  private sanitizeImageBaseName(book: Book): string {
    const raw = `${book.title} — ${book.author}`;
    const sanitized = raw
      // Thoroughly sanitize for Obsidian + common OS filename restrictions.
      .replace(/[\\/:?%*|"<>#[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Truncate to 200 chars to leave room for extension and path.
    return sanitized.slice(0, 200);
  }
}
