[![GitHub Repo stars](https://img.shields.io/github/stars/DuckTapeKiller/obsidian-book-search-plus?style=flat&logo=obsidian&color=%23483699)](https://github.com/DuckTapeKiller/obsidian-book-search-plus/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/DuckTapeKiller/obsidian-book-search-plus?logo=obsidian&color=%23483699)](https://github.com/DuckTapeKiller/obsidian-book-search-plus/issues)
[![GitHub closed issues](https://img.shields.io/github/issues-closed/DuckTapeKiller/obsidian-book-search-plus?logo=obsidian&color=%23483699)](https://github.com/DuckTapeKiller/obsidian-book-search-plus/issues?q=is%3Aissue+is%3Aclosed)
[![GitHub manifest version](https://img.shields.io/github/manifest-json/v/DuckTapeKiller/obsidian-book-search-plus?logo=obsidian&color=%23483699)](https://github.com/DuckTapeKiller/obsidian-book-search-plus/blob/main/manifest.json)
[![Downloads](https://img.shields.io/github/downloads/DuckTapeKiller/obsidian-book-search-plus/total?logo=obsidian&color=%23483699)](https://github.com/DuckTapeKiller/obsidian-book-search-plus/releases)


![Book Search Plus Art](https://github.com/user-attachments/assets/8a191a9a-bb79-4348-ae78-a4a21dd560c2)

# Book Search Plus

**Book Search Plus** is an advanced metadata aggregation plugin for Obsidian. It facilitates the creation of comprehensive book notes by consolidating data from multiple international sources, scraping dynamic web content, and applying automated enrichment pipelines.

---

## Table of Contents

- [Core Architecture](#core-architecture)
- [Search Modalities](#search-modalities)
- [Metadata Sources](#metadata-sources)
- [Universal Enrichment Pipeline](#universal-enrichment-pipeline)
- [Template System and Variables](#template-system-and-variables)
- [Calibre Integration](#calibre-integration)
- [Mobile Optimization](#mobile-optimization)
- [Installation and Credits](#installation-and-credits)

---

## Core Architecture

The plugin is designed around a multi-stage extraction engine that prioritizes data integrity and depth. Unlike standard plugins that rely on a single API, **Book Search Plus** uses a hybrid approach:

- [x] **Direct API Integration**: Utilizes official REST APIs for Google Books and OpenLibrary.
- [x] **Resilient Web Scraping**: Emplements custom parsing engines for Goodreads and StoryGraph to capture data not available via public APIs.
- [x] **Conflict Resolution**: Merges data from multiple providers using a prioritized scoring system.

---

## Search Modalities

### [i] Global Search
Consolidates results from all configured services into a single unified view. 
- Automatically deduplicates results by normalizing titles and authors.
- Displays source badges for each result to indicate data availability.
- Triggers the full enrichment pipeline upon selection.

### [i] Individual Service Search
Allows for targeted searching within a specific provider (e.g., searching only your local Calibre library or only StoryGraph).

---

## Metadata Sources

### StoryGraph (Advanced Scraper)
A high-resilience engine designed to bypass common scraping blocks.
- [!] **Translator Extraction**: Specifically targets and isolates translator information.
- [!] **Edition Precision**: Allows selection of specific editions (e.g., by publisher or cover).
- [!] **JSON-LD Fallback**: Parses structured metadata even when standard HTML elements are obscured.

### Goodreads (Primary Enrichment)
The industry standard for social book metadata.
- [!] **Rich Metadata**: Captures original titles, total pages, and ASINs.
- [!] **High-Res Covers**: Automatically attempts to fetch the highest resolution available.

### OpenLibrary and Google Books
Reliable fallbacks for ISBN validation and categorized genre data.

---

## Universal Enrichment Pipeline

When a book is selected, the plugin initiates a sequential enrichment process:

1. **Step 1: Primary Fetch**: Retrieves full details from the selected source.
2. **Step 2: Goodreads Fallback**: If the primary source lacks an ISBN, the plugin searches Goodreads by title/author to recover the identifier.
3. **Step 3: Multi-Source Bridge**: Uses the ISBN to fetch missing fields (description, genres, publisher) from all other providers in parallel.
4. **Step 4: Passive Enrichment (Fable.co)**: Scans Fable.co for high-quality descriptions and covers if still missing.
5. **Step 5: Library of Congress (LoC)**: Validates publication dates and page counts against official records.

---

## Template System and Variables

The plugin utilizes a Handlebars-based template system.

### [!] Default Frontmatter Template (English)
The plugin provides localized default templates. Below is the English structure:

```yaml
---
Title: "{{title}}"
Original title: "{{originalTitle}}"
Author: "{{author}}"
Translator: "{{translator}}"
Prologue: ""
Description: "{{description}}"
Total Pages: "{{totalPage}}"
Publisher: {{publisher}}
Categories: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Published: {{publishDate}}
Date read:
Cover: "{{localCoverImage}}"
Link: {{link}}
Tags: {{tags}}
Read: false
---
```

### [i] Supported Languages
[!] **Default Language**: The plugin initializes with the Spanish template by default.
[i] **Customization**: You can choose and restore default templates for any of the following 11 languages directly from the settings menu:
- Spanish, English, French, German, Italian, Portuguese, Dutch, Russian, Simplified Chinese, Japanese, and Korean.

### [!] Mandatory Tag Syntax
When using the `{{tags}}` variable in YAML, it must be wrapped in quotes to remain valid during the transformation process:
`tags: "{{tags}}"`
The plugin will automatically convert this into a proper YAML list format upon note creation.


### Available Variables
- `{{title}}`: Current edition title.
- `{{originalTitle}}`: Original work title.
- `{{author}}`: Primary author.
- `{{translator}}`: Book translator (StoryGraph/Goodreads).
- `{{description}}`: Full summary.
- `{{totalPage}}`: Page count.
- `{{publisher}}`: Publishing house.
- `{{publishDate}}`: Publication date.
- `{{isbn13}}` / `{{isbn10}}`: Industry identifiers.
- `{{asin}}`: Amazon identification number.
- `{{link}}`: Direct link to the source book page.
- `{{categories}}`: List of genres and categories.
- `{{localCoverImage}}`: Path to the locally saved cover file.
- `{{tags}}`: Automated `author/name` and `libros/title` tags.

---

## [i] Duplicate Detection
To maintain vault organization, the plugin includes an automated safeguard:
- [x] **Vault Scanning**: Before creating a note, the plugin checks for existing files with a matching title or ISBN.
- [x] **Action Prompts**: If a match is found, you can choose to open the existing note, create a duplicate anyway, or cancel the operation.


---

## Calibre Integration

To integrate with a local Calibre library, the **Calibre Content Server** must be active:
1. Enable **Sharing over the net** in Calibre Preferences.
2. Ensure the port (default 8080) is accessible.
3. [!] **Calibre Workflows**:
   - [x] **Search Calibre (Multi-Select)**: Allows batch importing via search results.
     - **Enrichment Limit**: If importing **5 or fewer books**, the plugin performs full online enrichment (multi-source).
     - **Batch Import**: If selecting **more than 5 books**, enrichment is skipped to maintain performance, using only Calibre metadata.
   - [x] **Browse Calibre Library**: Allows navigating your library by Author, Series, or Tag. This mode **always** uses local Calibre metadata exclusively to ensure instant results while browsing large collections.


---

## Mobile Optimization

The interface has been specifically hardened for the Obsidian Mobile application (iOS/Android):
- [+] **Responsive Modals**: Search inputs and result lists automatically adapt to small viewports.
- [+] **Keyboard Clearance**: Modals are positioned to remain visible while the system keyboard is active.
- [+] **Flexible Settings**: Textareas and input fields in the settings panel utilize an adaptive vertical layout on mobile devices.

---

## Installation and Credits

### [i] Installation
1. Navigate to your Obsidian vault's hidden configuration folder: `<vault>/.obsidian/plugins/`.
2. Create a new directory named `book-search-plus`.
3. Download the latest release files from the GitHub repository.
4. Place the following three files into the `book-search-plus` folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. Open Obsidian and enable **Book Search Plus** in the Community Plugins settings.

### [i] Acknowledgments
- Based on the original [obsidian-book-search-plugin](https://github.com/anpigon/obsidian-book-search-plugin) by anpigon.
- Developed and maintained by **DuckTapeKiller**.
