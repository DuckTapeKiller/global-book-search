// What a contributor's role means for a note: author, translator, narrator or
// someone else (illustrator, editor, the writer of an introduction…).

// Goodreads roles are free text that librarians type in their own language:
// "Translator", "Translation", "Traductor", "Tradução", "Übersetzer", "trad.",
// "Translator, Introduction", "Editor, Translator"…
const TRANSLATOR_ROLE =
  /translat|tradu|trad\.|übersetz|oversett|översätt|vertal|tłumacz|přelož|překlad|prevod|prevaj|перев|suoment|fordít|penerjemah|çevir|μετάφρ|ترجم|وەرگێڕ|翻訳|翻译|翻譯|번역/iu;
const NARRATOR_ROLE =
  /narrat|read by|^reader\b|narrador|locutor|sprecher|lecteur|lu par|lettore|letto da|leído por|lido por|voorgelezen|czyta|читает/iu;

export type ContributorKind = "author" | "translator" | "narrator" | "other";

/**
 * What a contributor role means for a note. A translator is recognised by the
 * word in any language and anywhere in the role, so "Editor, Translator" and
 * "Translator, Afterword by" count; an empty role is an author.
 */
export function contributorKind(role: string): ContributorKind {
  const value = (role || "").trim();
  if (!value || /^(author|pseudonym)$/i.test(value)) return "author";
  if (TRANSLATOR_ROLE.test(value)) return "translator";
  if (NARRATOR_ROLE.test(value)) return "narrator";
  return "other";
}

// Hardcover names roles from a fixed list (its contributor_roles table). These
// make a person one of the book's authors; the rest of the list (Illustrator,
// Editor, Introduction, Afterword…) are contributors, not authors.
const HARDCOVER_AUTHOR_ROLES = new Set([
  "author",
  "co-author",
  "co-writer",
  "writer",
  "contributing author",
  "original author",
  "poet",
  "playwright",
  "essayist",
]);

/** What a Hardcover contribution ("Translator", "Narrator", null…) means for a note. */
export function hardcoverContributorKind(role: string): ContributorKind {
  const value = (role || "").trim();
  if (!value || HARDCOVER_AUTHOR_ROLES.has(value.toLowerCase()))
    return "author";
  if (/^(reading|voice actor)$/i.test(value)) return "narrator";
  return contributorKind(value);
}

function personWords(name: string): string[] {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/**
 * Whether two names are one person as sources write them: the same words, or
 * all the words of the shorter name (two at least) in the longer one ("Alicia
 * Dellepiane" and "Alicia Dellepiane Rawson").
 */
export function samePerson(a: string, b: string): boolean {
  const wordsA = personWords(a);
  const wordsB = personWords(b);
  const [shorter, longer] =
    wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  if (!shorter.length) return false;
  if (shorter.length === 1) return shorter.join() === longer.join();
  return shorter.every((word) => longer.includes(word));
}
