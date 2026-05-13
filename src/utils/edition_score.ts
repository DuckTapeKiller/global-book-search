import { Book } from "@models/book.model";

export function scoreBookCandidate(book: Partial<Book>): number {
  let score = 0;

  if (book.isbn13) score += 20;
  if (book.isbn10) score += 15;
  if (book.publisher) score += 10;

  const pages =
    typeof book.totalPage === "number"
      ? book.totalPage
      : typeof book.totalPage === "string"
        ? parseInt(book.totalPage, 10)
        : 0;
  if (pages && !Number.isNaN(pages)) score += 12;

  if (book.coverUrl) score += 10;
  if (book.publishDate) score += 6;
  if (book.categories || book.category) score += 6;
  if (book.description) score += 4;
  if (book.originalTitle) score += 2;
  if (book.translator) score += 2;

  // Encourage complete author/title pairs.
  if (book.title) score += 2;
  if (book.author) score += 2;

  return score;
}
