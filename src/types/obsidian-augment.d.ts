import "obsidian";

// SecretStorage / SecretComponent ship in newer Obsidian than the pinned 1.8.7
// typings expose. Declaring them here lets the plugin use them (guarded by
// runtime feature-detection) without un-pinning obsidian and reopening the
// deprecation-lint issues.
declare module "obsidian" {
  interface SecretStorage {
    getSecret(name: string): Promise<string | null>;
    setSecret(name: string, value: string): Promise<void>;
    deleteSecret(name: string): Promise<void>;
    listSecrets(): Promise<string[]>;
  }

  interface App {
    secretStorage?: SecretStorage;
  }

  interface Setting {
    addComponent(cb: (containerEl: HTMLElement) => unknown): this;
  }

  class SecretComponent {
    constructor(app: App, containerEl: HTMLElement);
    setValue(name: string): this;
    getValue(): string;
    setPlaceholder(placeholder: string): this;
    onChange(callback: (value: string) => void): this;
  }
}
