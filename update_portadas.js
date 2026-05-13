#!/usr/bin/env node
/**
 * Bulk Update Book Note Covers
 * 
 * This script updates the "Portada" frontmatter field in all markdown files:
 * 1. Replaces regular dash (-) with em-dash (—) in the path
 * 2. Wraps the path in [[...]] wiki link syntax if not already
 * 
 * Usage: node update_portadas.js /path/to/your/vault
 * 
 * Add --dry-run to preview changes without modifying files
 */

const fs = require('fs');
const path = require('path');

const vaultPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!vaultPath) {
    console.error('Usage: node update_portadas.js /path/to/vault [--dry-run]');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run    Preview changes without modifying files');
    process.exit(1);
}

// Resolve to absolute path
const absoluteVaultPath = path.resolve(vaultPath);

if (!fs.existsSync(absoluteVaultPath)) {
    console.error(`Error: Vault path does not exist: ${absoluteVaultPath}`);
    process.exit(1);
}

console.log(`${dryRun ? '[DRY RUN] ' : ''}Scanning vault: ${absoluteVaultPath}`);
console.log('');

let filesUpdated = 0;
let filesSkipped = 0;

function processFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');

    // Check if file has frontmatter
    if (!content.startsWith('---')) {
        return;
    }

    // Find the end of frontmatter
    const endIndex = content.indexOf('---', 3);
    if (endIndex === -1) {
        return;
    }

    const frontmatter = content.substring(0, endIndex + 3);
    const body = content.substring(endIndex + 3);

    // Look for Portada field (case-insensitive)
    const portadaMatch = frontmatter.match(/^(Portada:\s*)"?([^"\n]+)"?\s*$/m);

    if (!portadaMatch) {
        return;
    }

    const originalLine = portadaMatch[0];
    let portadaValue = portadaMatch[2].trim();

    // Skip if empty
    if (!portadaValue) {
        return;
    }

    // Check if already has wiki link syntax
    const hasWikiLink = portadaValue.startsWith('[[') && portadaValue.endsWith(']]');

    // Extract the path (remove [[ ]] if present)
    let imagePath = hasWikiLink
        ? portadaValue.slice(2, -2)
        : portadaValue;

    // Replace regular dash with em-dash (only between title and author, not in paths)
    // Pattern: word space dash space word (before .jpg)
    const originalPath = imagePath;
    imagePath = imagePath.replace(/ - (?=[^/]+\.jpg$)/g, ' — ');

    // Format as wiki link
    const newValue = `"[[${imagePath}]]"`;
    const newLine = `Portada: ${newValue}`;

    // Check if anything changed
    if (originalLine.trim() === newLine.trim()) {
        filesSkipped++;
        return;
    }

    // Update frontmatter
    const newFrontmatter = frontmatter.replace(originalLine, newLine);
    const newContent = newFrontmatter + body;

    const relativePath = path.relative(absoluteVaultPath, filePath);

    console.log(`${dryRun ? '[WOULD UPDATE]' : '[UPDATED]'} ${relativePath}`);
    console.log(`  Old: ${originalLine.trim()}`);
    console.log(`  New: ${newLine}`);
    console.log('');

    if (!dryRun) {
        fs.writeFileSync(filePath, newContent, 'utf8');
    }

    filesUpdated++;
}

function walkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip hidden directories and common non-content folders
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
        }

        if (entry.isDirectory()) {
            walkDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            processFile(fullPath);
        }
    }
}

walkDirectory(absoluteVaultPath);

console.log('-----------------------------------');
console.log(`${dryRun ? '[DRY RUN] ' : ''}Complete!`);
console.log(`  Files updated: ${filesUpdated}`);
console.log(`  Files skipped (already correct): ${filesSkipped}`);

if (dryRun && filesUpdated > 0) {
    console.log('');
    console.log('Run without --dry-run to apply changes.');
}
