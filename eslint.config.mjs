import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

// Official Obsidian plugin-review lint config. `obsidianmd.configs.recommended`
// bundles typescript-eslint's recommended + recommended-type-checked rules and
// every obsidianmd/* rule the community-plugin review bot runs — so `npm run
// lint` here catches the same issues locally, before submitting a release.
export default [
    {
        ignores: [
            'node_modules',
            'dist',
            'main.js',
            'coverage',
            'jest.config.js',
            'version-bump.mjs',
            'esbuild.config.mjs',
            'eslint.config.mjs',
            'update_portadas.js',
            '**/*.test.ts',
        ],
    },
    ...obsidianmd.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                console: 'readonly',
            },
            // Type-aware rules (no-unsafe-*, no-floating-promises, …) need the
            // TS program; the plugin config leaves this to the consumer.
            parserOptions: {
                project: './tsconfig.json',
            },
        },
        rules: {
            // The review tolerates intentionally-unused, underscore-prefixed names.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            // `no-undef` produces false positives on TypeScript built-in types
            // (e.g. PromiseFulfilledResult); TS itself already checks for this,
            // so typescript-eslint recommends turning it off for .ts files.
            'no-undef': 'off',
            // Opinionated UI-casing rule that mis-fires on acronyms ("ISBN") and
            // on Notice/console message text rather than actual UI labels. Left
            // off so the build isn't blocked by cosmetic, often-wrong suggestions.
            'obsidianmd/ui/sentence-case': 'off',
        },
    },
];
