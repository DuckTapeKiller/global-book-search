import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

// Obsidian's official plugin lint, exactly as the community-plugin review bot
// runs it: `obsidianmd.configs.recommended` with its own file globs (every
// TS/JS file, package.json, manifest.json and LICENSE). Only build output and
// dependencies are left out, and no rule is switched off.
export default defineConfig([
    {
        ignores: ['node_modules/', 'main.js', 'coverage/'],
    },
    ...obsidianmd.configs.recommended,
    {
        // The type-aware rules need the TypeScript program.
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // Obsidian's guidelines ask for sentence case in UI text. The
        // recommended config leaves this rule off; it is on here, with the
        // names and acronyms this plugin uses. Both lists replace the rule's
        // defaults, so the defaults this plugin needs are repeated.
        files: ['**/*.ts'],
        rules: {
            'obsidianmd/ui/sentence-case': [
                'warn',
                {
                    enforceCamelCaseLower: true,
                    brands: [
                        'Obsidian',
                        'GitHub',
                        'Google',
                        'Global Book Search',
                        'Google Books',
                        'Google Cloud Console',
                        'Goodreads',
                        'Open Library',
                        'OpenLibrary',
                        'StoryGraph',
                        'Hardcover',
                        'LibraryThing',
                        'Calibre',
                        'Fable',
                        'Library of Congress',
                        'Cloudflare',
                        'Ko-fi',
                        'DuckTapeKiller',
                        'WebP',
                    ],
                    acronyms: [
                        'ID',
                        'OK',
                        'JSON',
                        'YAML',
                        'HTML',
                        'HTTPS',
                        'ISBN',
                        'ISBNs',
                        'ASIN',
                        'API',
                        'HTTP',
                        'TTL',
                        'URL',
                        'UTC',
                        'JPG',
                        'PNG',
                    ],
                },
            ],
        },
    },
    {
        // Build and maintenance scripts run in Node, not in Obsidian.
        files: ['*.js', '*.mjs', 'scripts/**/*.js'],
        languageOptions: {
            globals: globals.node,
        },
    },
]);
