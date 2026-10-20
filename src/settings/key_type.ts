/**
 * Shape of the auto-generated frontmatter keys (see `applyDefaultFrontMatter`).
 *
 * Kept in its own module so pure utilities can import the enum without pulling
 * in the settings UI (and therefore Obsidian) through `@settings/settings`.
 */
export enum DefaultFrontmatterKeyType {
  snakeCase = "Snake Case",
  camelCase = "Camel Case",
}
