import { parseBookDate } from "@utils/dates";

describe("parseBookDate", () => {
  it.each([
    ["November 20, 1996", "1996/11/20"],
    ["Nov 20 1996", "1996/11/20"],
    ["September 12th 2000", "2000/09/12"],
    ["20 November 1996", "1996/11/20"],
    ["August 2025", "2025/08"],
    ["1993-03", "1993/03"],
    ["2006-01-03", "2006/01/03"],
    ["2005", "2005"],
    ["c1994", "1994"],
    ["[1994?]", "1994"],
    ["", ""],
    ["unknown", ""],
  ])("%j → %j", (text, date) => {
    expect(parseBookDate(text)).toBe(date);
  });
});
