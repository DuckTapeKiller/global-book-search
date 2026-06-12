import { mergeBookData } from "@apis/goodreads_api";
import { Book } from "@models/book.model";

const searchResultBook: Book = {
  title: "The Hobbit",
  author: "J.R.R. Tolkien",
  authors: ["J.R.R. Tolkien"],
  coverUrl: "https://i.gr-assets.com/images/S/books/5907._SY475_.jpg",
  coverSmallUrl: "https://i.gr-assets.com/images/S/books/5907._SY75_.jpg",
  link: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  previewLink: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  description: "In a hole in the ground there lived a hobbit…",
  publisher: "",
  publishDate: "",
  totalPage: "366",
  isbn10: "",
  isbn13: "",
  categories: "",
  category: "",
  originalTitle: "",
  translator: "",
  narrator: "",
  subtitle: "",
  asin: "",
};

const blankExtraction: Book = {
  title: "",
  author: "",
  authors: [""],
  coverUrl: "",
  coverSmallUrl: "",
  link: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  previewLink: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  description: "",
  publisher: "",
  publishDate: "",
  totalPage: "",
  isbn10: "",
  isbn13: "",
  categories: "",
  category: "",
  originalTitle: "",
  translator: "",
  narrator: "",
  subtitle: "",
  asin: "",
};

describe("mergeBookData", () => {
  it("keeps every search-result field when the extraction is blank", () => {
    const merged = mergeBookData(searchResultBook, blankExtraction);
    expect(merged.title).toBe("The Hobbit");
    expect(merged.author).toBe("J.R.R. Tolkien");
    expect(merged.authors).toEqual(["J.R.R. Tolkien"]);
    expect(merged.coverUrl).toBe(searchResultBook.coverUrl);
    expect(merged.description).toBe(searchResultBook.description);
    expect(merged.totalPage).toBe("366");
  });

  it("prefers extracted values when they are non-empty", () => {
    const extracted: Book = {
      ...blankExtraction,
      title: "The Hobbit, or There and Back Again",
      publisher: "Houghton Mifflin",
      publishDate: "1937/09/21",
      isbn13: "9780547928227",
      categories: "Fantasy, Classics",
      authors: ["J.R.R. Tolkien", "Alan Lee"],
    };
    const merged = mergeBookData(searchResultBook, extracted);
    expect(merged.title).toBe("The Hobbit, or There and Back Again");
    expect(merged.publisher).toBe("Houghton Mifflin");
    expect(merged.publishDate).toBe("1937/09/21");
    expect(merged.isbn13).toBe("9780547928227");
    expect(merged.categories).toBe("Fantasy, Classics");
    expect(merged.authors).toEqual(["J.R.R. Tolkien", "Alan Lee"]);
    // Untouched fields keep search-result values.
    expect(merged.description).toBe(searchResultBook.description);
    expect(merged.totalPage).toBe("366");
  });

  it("does not let whitespace-only strings or empty arrays overwrite data", () => {
    const extracted: Book = {
      ...blankExtraction,
      title: "   ",
      authors: [],
    };
    const merged = mergeBookData(searchResultBook, extracted);
    expect(merged.title).toBe("The Hobbit");
    expect(merged.authors).toEqual(["J.R.R. Tolkien"]);
  });
});
