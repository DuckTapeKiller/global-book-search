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
    (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
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
        // Fix: Cast unit to satisfy linter
        currentDate.add(
          parseInt(timeDelta, 10),
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

export function executeInlineScriptsTemplates(book: Book, text: string) {
  if (!text?.includes("<%=")) return text;

  // Non-greedy and multiline-safe to support multiple inline expressions per template.
  const commandRegex = /<%=\s*([\s\S]+?)\s*%>/g;

  return text.replace(commandRegex, (matched: string, script: string) => {
    try {
      // Direct Function usage enables user-authored templates to render dynamic values.
      // Note: This is intentionally powerful and should only ever be evaluated on
      // user-controlled template text (never on substituted remote metadata).
      const func = new Function(
        "book",
        [
          '"use strict"',
          `const output = (${script})`,
          'if (typeof output === "string") return output',
          "return JSON.stringify(output)",
        ].join(";"),
      );
      return func(book) as string;
    } catch (err) {
      console.warn(err);
      return matched;
    }
  });
}

export async function useTemplaterPluginInFile(app: App, file: TFile) {
  // @ts-ignore
  const templater = app.plugins.plugins["templater-obsidian"];
  if (templater && !templater?.settings["trigger_on_file_creation"]) {
    await templater.templater.overwrite_file_commands(file);
  }
}
