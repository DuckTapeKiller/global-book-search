import { Book } from "@models/book.model";
import { App, normalizePath, Notice, TFile } from "obsidian";

export async function getTemplateContents(
  app: App,
  templatePath: string | undefined,
): Promise<string> {
  const { metadataCache, vault } = app;
  const normalizedTemplatePath = normalizePath(templatePath ?? "");
  if (templatePath === "/") {
    return "";
  }

  try {
    const templateFile = metadataCache.getFirstLinkpathDest(
      normalizedTemplatePath,
      "",
    );
    // Fix: Added await
    return templateFile ? await vault.cachedRead(templateFile) : "";
  } catch (err) {
    // Fix: Updated error message to be relevant to this plugin
    console.error(
      `Failed to read the book template '${normalizedTemplatePath}'`,
      err,
    );
    new Notice("Failed to read the book template");
    return "";
  }
}

export function applyTemplateTransformations(
  rawTemplateContents: string,
): string {
  return rawTemplateContents.replace(
    /{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
    (
      _match: string,
      _timeOrDate: string,
      calc: string | undefined,
      timeDelta: string | undefined,
      unit: string | undefined,
      momentFormat: string | undefined,
    ) => {
      const now = window.moment();
      const currentDate = window
        .moment()
        .clone()
        .set({
          hour: now.get("hour"),
          minute: now.get("minute"),
          second: now.get("second"),
        });
      if (calc) {
        currentDate.add(
          parseInt(timeDelta ?? "0", 10),
          unit as moment.unitOfTime.DurationConstructor,
        );
      }

      if (momentFormat) {
        return currentDate.format(momentFormat.substring(1).trim());
      }
      return currentDate.format("YYYY-MM-DD");
    },
  );
}

export function executeInlineScriptsTemplates(
  book: Book,
  text: string,
): string {
  if (!text?.includes("<%=")) return text;

  // Non-greedy and multiline-safe to support multiple inline expressions per template.
  const commandRegex = /<%=\s*([\s\S]+?)\s*%>/g;

  return text.replace(commandRegex, (matched: string, script: string) => {
    try {
      const path = script.trim();
      // Only support simple property access on 'book', e.g., 'book.title' or 'book.authors[0]'
      if (!path.startsWith("book.") && path !== "book") {
        console.warn(
          `[Global Book Search] Unsupported template expression: ${path}. Only 'book' property access is supported.`,
        );
        return matched;
      }

      const cleanPath = path
        .replace(/^book\.?/, "")
        .replace(/\[['"]?(\w+)['"]?\]/g, ".$1");
      if (!cleanPath) {
        return typeof book === "string" ? book : JSON.stringify(book);
      }

      const keys = cleanPath.split(".").filter(Boolean);
      let current: unknown = book;

      for (const key of keys) {
        if (current === undefined || current === null) {
          return "";
        }
        current = (current as Record<string, unknown>)[key];
      }

      if (current === undefined || current === null) return "";
      if (typeof current === "string") return current;
      return JSON.stringify(current);
    } catch (err) {
      console.warn(
        `[Global Book Search] Failed to parse template expression: ${script}`,
        err,
      );
      return matched;
    }
  });
}

interface TemplaterPlugin {
  templater?: { overwrite_file_commands: (file: TFile) => Promise<void> };
  settings?: Record<string, unknown>;
}

export async function useTemplaterPluginInFile(app: App, file: TFile) {
  // `app.plugins` is part of Obsidian's internal (untyped) API.
  const plugins = (
    app as App & {
      plugins?: { plugins?: Record<string, TemplaterPlugin | undefined> };
    }
  ).plugins;
  const templater = plugins?.plugins?.["templater-obsidian"];
  if (templater && !templater.settings?.["trigger_on_file_creation"]) {
    await templater.templater?.overwrite_file_commands(file);
  }
}
