import { Book } from "./book.model";

export interface BookEdition extends Book {
  format?: string;
  _providerId: string;
  score?: number;
}

export interface FieldConflict {
  fieldName: string;
  label: string;
  values: {
    value: unknown;
    source: string;
    isQuorum: boolean;
  }[];
  currentBestValue: unknown;
}

export interface EnrichmentResult {
  book: Book;
  sources: string[];
  conflicts: FieldConflict[];
}

export interface VaultIndexEntry {
  path: string;
  isbn13?: string;
  isbn10?: string;
}
