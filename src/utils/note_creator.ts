import { App, parseYaml, TFile } from "obsidian";
import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { httpRequest } from "@utils/http";
import {
  useTemplaterPluginInFile,
  getTemplateContents,
  applyTemplateTransformations,
  executeInlineScriptsTemplates,
} from "@utils/template";
import { applySeriesFields } from "@utils/series";
import {
  makeFileName,
  applyDefaultFrontMatter,
  replaceVariableSyntax,
  toStringFrontMatter,
  parseFrontMatter,
  createBookTags,
} from "@utils/utils";

/** `"text"` as written in a template becomes `text`; anything else is unchanged. */
export function unquoteYamlScalar(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const quoted = /^"([\s\S]*)"$/.exec(value.trim());
  return quoted ? quoted[1].replace(/\\"/g, '"') : value;
}

/** No value at all: nothing, an empty string or an empty list. */
function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * A property value exactly as a new note would hold it: written the way a new
 * note's frontmatter is written, then read back the way Obsidian reads it, so
 * numbers, booleans and lists keep their types. Undefined when a new note
 * would not get the property either.
 */
export function asNewNoteValue(key: string, value: unknown): unknown {
  const yaml = toStringFrontMatter({ [key]: value });
  if (!yaml) return undefined;
  try {
    const parsed: unknown = parseYaml(yaml);
    if (parsed && typeof parsed === "object" && key in parsed) {
      return (parsed as Record<string, unknown>)[key];
    }
  } catch {
    // Not valid YAML on its own: fall back to the bare value.
  }
  return Array.isArray(value)
    ? value.map(unquoteYamlScalar)
    : unquoteYamlScalar(value);
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

    const targetFile = await this.app.vault.create(
      this.availablePath(filePath),
      renderedContents,
    );
    await useTemplaterPluginInFile(this.app, targetFile);
    return targetFile;
  }

  /**
   * `path`, or "… 1.md", "… 2.md" when a note already has that name, so
   * **Create anyway** makes a second note instead of failing.
   */
  private availablePath(path: string): string {
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const base = path.replace(/\.md$/i, "");
    for (let i = 1; ; i++) {
      const candidate = `${base} ${i}.md`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
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

  /**
   * Refresh an existing note's properties from `book`. Only properties the
   * template fills in from the book ({{variables}} or inline scripts) are
   * refreshed: fixed template values, such as `Read: false` or an empty
   * `Date read:`, belong to the reader once the note exists. A value the
   * sources left empty never erases one the note already has, and every value
   * gets the type a new note would give it.
   */
  async updateMetadata(file: TFile, book: Book): Promise<void> {
    const template = parseFrontMatter(await this.frontmatterTemplate());
    const resolvedFrontmatter = await this.getResolvedFrontmatter(book);
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resolvedFrontmatter)) {
      const written = (template as Record<string, unknown>)[key];
      if (typeof written === "string" && !/{{|<%/.test(written)) continue;
      const next = asNewNoteValue(key, value);
      if (next !== undefined) values[key] = next;
    }
    await this.app.fileManager.processFrontMatter(
      file,
      (fm: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) {
          if (isBlank(value) && !isBlank(fm[key])) continue;
          fm[key] = value;
        }
      },
    );
  }

  /** The frontmatter template as written: the setting, or the template file's. */
  private async frontmatterTemplate(): Promise<string> {
    if (this.settings.templateFile) {
      const templateContent = await getTemplateContents(
        this.app,
        this.settings.templateFile,
      );
      if (templateContent) {
        const transformedTemplate =
          applyTemplateTransformations(templateContent);
        const splitContent = transformedTemplate.split("---");
        if (splitContent.length >= 3) return splitContent[1];
      }
    }
    return this.settings.frontmatter;
  }

  async getResolvedFrontmatter(book: Book): Promise<Record<string, unknown>> {
    // Generate tags automatically
    book.tags = createBookTags(
      book,
      this.settings.authorTagPrefix,
      this.settings.titleTagPrefix,
    );

    // {{series}} and {{seriesNumber}} come from the provider; {{seriesLink}}
    // follows the "Enable series linking" setting.
    applySeriesFields(book, this.settings.enableSeriesLinking);

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

    let frontmatter = await this.frontmatterTemplate();

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
        // A value that is exactly one array variable (e.g. "{{tags}}", unquoted)
        // must keep its array shape so it serialises as a YAML block sequence
        // instead of being flattened into an invalid inline string.
        const single = value.trim().match(/^{{(\w+)}}$/);
        const bookField = single
          ? (book as unknown as Record<string, unknown>)[single[1]]
          : undefined;
        if (Array.isArray(bookField)) {
          resolvedFrontmatter[key] = bookField;
        } else {
          resolvedFrontmatter[key] = replaceVariableSyntax(book, value);
        }
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
