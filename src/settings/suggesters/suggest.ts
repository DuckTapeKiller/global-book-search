import { App, AbstractInputSuggest } from "obsidian";

export abstract class TextInputSuggest<T> extends AbstractInputSuggest<T> {
  constructor(
    app: App,
    protected inputEl: HTMLInputElement | HTMLTextAreaElement,
  ) {
    super(app, inputEl as HTMLInputElement);
  }

  abstract getSuggestions(inputStr: string): T[];
  abstract renderSuggestion(item: T, el: HTMLElement): void;
  abstract selectSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}
