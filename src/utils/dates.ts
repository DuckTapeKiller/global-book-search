// Dates as catalogues write them ("November 20, 1996", "1993-03", "Sep 2012",
// "c1994") turned into the plugin's form: "1996/11/20", "1993/03" or "1994".

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function month(name: string): string {
  return MONTHS[name.slice(0, 3).toLowerCase()] || "";
}

function day(value: string): string {
  const number = Number(value);
  return number >= 1 && number <= 31 ? String(number).padStart(2, "0") : "";
}

/**
 * A publication date as "yyyy/mm/dd", "yyyy/mm" or "yyyy", whatever form the
 * catalogue wrote it in; "" when it holds no year.
 */
export function parseBookDate(text: string): string {
  const value = (text || "").trim();
  let match = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/.exec(value);
  if (match) {
    const mm = match[2].padStart(2, "0");
    if (Number(mm) < 1 || Number(mm) > 12) return match[1];
    const dd = match[3] ? day(match[3]) : "";
    return dd ? `${match[1]}/${mm}/${dd}` : `${match[1]}/${mm}`;
  }
  // "November 20, 1996", "Nov 20 1996"
  match = /\b([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(
    value,
  );
  if (match && month(match[1])) {
    const dd = day(match[2]);
    return dd
      ? `${match[3]}/${month(match[1])}/${dd}`
      : `${match[3]}/${month(match[1])}`;
  }
  // "20 November 1996"
  match = /\b(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b/.exec(value);
  if (match && month(match[2])) {
    const dd = day(match[1]);
    return dd
      ? `${match[3]}/${month(match[2])}/${dd}`
      : `${match[3]}/${month(match[2])}`;
  }
  // "November 1996"
  match = /\b([A-Za-z]{3,})\.?,?\s+(\d{4})\b/.exec(value);
  if (match && month(match[1])) return `${match[2]}/${month(match[1])}`;
  // "1996", "c1994", "[1994?]"
  match = /(?:^|\D)(1[5-9]\d{2}|20\d{2})(?!\d)/.exec(value);
  return match ? match[1] : "";
}
