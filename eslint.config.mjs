
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
// import obsidianPlugin from 'eslint-plugin-obsidianmd';
import globals from 'globals';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ['node_modules', 'dist', 'main.js', 'coverage', 'jest.config.js', 'version-bump.mjs', 'esbuild.config.mjs', 'update_portadas.js'],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.node,
                console: 'readonly',
            },
            parserOptions: {
                project: './tsconfig.json',
            },
        },
        plugins: {
            // 'obsidianmd': obsidianPlugin,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
            // ...obsidianPlugin.configs.recommended.rules,
        },
    },
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.node,
                console: 'readonly',
            },
        },
    }
);
