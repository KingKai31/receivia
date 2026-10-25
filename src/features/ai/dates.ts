import { addDays, type ISODate } from '@/lib/dates';

const DEV = '०१२३४५६७८९';
/** Devanagari digits to ASCII. */
export const asciiDigits = (s: string): string =>
  s.replace(/[०-९]/g, (d) => String(DEV.indexOf(d)));

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const WEEKDAYS: [RegExp, number][] = [
  [/\b(mon(day)?|somvar|सोमवार|सोमवारी)\b|सोमवार/i, 1],
  [/\b(tue(s|sday)?|mangalvar|मंगलवार|मंगळवार)\b|मंगळवार|मंगलवार/i, 2],
  [/\b(wed(nesday)?|budhvar|बुधवार)\b|बुधवार/i, 3],
  [/\b(thu(rs|rsday)?|guruvar|veervar|गुरुवार)\b|गुरुवार|गुरूवार/i, 4],
  [/\b(fri(day)?|shukravar|शुक्रवार)\b|शुक्रवार/i, 5],
  [/\b(sat(urday)?|shanivar|शनिवार)\b|शनिवार/i, 6],
  [/\b(sun(day)?|ravivar|रविवार)\b|रविवार/i, 0],
];

const pad = (n: number) => String(n).padStart(2, '0');
function valid(y: number, m: number, d: number): ISODate | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}` as ISODate;
}
function dow(iso: ISODate): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** First date on or after `today` with this day of month (this month, else next). */
function nextDayOfMonth(today: ISODate, d: number): ISODate | null {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const here = valid(y, m, d);
  if (here && here >= today) return here;
  const ny = m === 12 ? y + 1 : y;
  return valid(ny, m === 12 ? 1 : m + 1, d);
}

/** Finds the date a buyer names, relative to `today` (IST). Returns null when none is clear. */
export function parseDate(raw: string, today: ISODate): ISODate | null {
  const s = asciiDigits(raw).toLowerCase();
  const yr = Number(today.slice(0, 4));
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return valid(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : yr;
    const d = valid(y, +m[2]!, +m[1]!);
    if (d) return !m[3] && d < today ? valid(y + 1, +m[2]!, +m[1]!) : d;
  }
  if (
    (m = s.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/,
    ))
  ) {
    const d = valid(yr, MONTHS[m[2]!]!, +m[1]!);
    if (d) return d < today ? valid(yr + 1, MONTHS[m[2]!]!, +m[1]!) : d;
  }
  if (/\b(day after tomorrow|parso|parson)\b|परसों|परवा/.test(s)) return addDays(today, 2);
  if (/\b(tomorrow|tmrw|kal|udya)\b|कल |कल$|उद्या/.test(s)) return addDays(today, 1);
  if (/\b(today|aaj|aj)\b|आज/.test(s)) return today;
  if (
    /next week|agle hafte|agle week|अगले हफ्ते|अगले सप्ताह|पुढच्या आठवड्यात|पुढील आठवड्यात/.test(s)
  )
    return addDays(today, 7);
  if (
    (m = s.match(
      /(?:by |on |til |till |tak |ko )?\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:tarikh|tareekh|tarikhe?|tak\b)|(\d{1,2})\s*(?:तारीख|तारखेला|तारखेपर्यंत|तारिख|तक)/,
    ))
  )
    return nextDayOfMonth(today, +(m[1] ?? m[2])!);
  if (
    (m = s.match(
      /\b(?:by|on|before)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b|\b(\d{1,2})(?:st|nd|rd|th)\b/,
    ))
  )
    return nextDayOfMonth(today, +(m[1] ?? m[2])!);
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(s)) {
      const delta = (wd - dow(today) + 7) % 7 || 7;
      return addDays(today, delta);
    }
  }
  return null;
}

/** First rupee amount named, as integer paise. Understands 50,000 / 50k / 2 lakh / 25 hazar / हजार. */
export function parseAmountPaise(raw: string): number | null {
  const s = asciiDigits(raw)
    .toLowerCase()
    .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, ' ')
    .replace(/(utr|ref|reference|txn|inv|invoice|no\.?|#)\s*[:#-]?\s*[\w/-]+/g, ' ')
    .replace(/(\d),(?=\d)/g, '$1');
  const re =
    /(₹|rs\.?|inr|rupees?)?\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|लाख|k\b|hazaar|hazar|hajar|हजार|हज़ार|crores?|करोड़|करोड|rupees?|rupay|रुपये|रुपय|रु(?![\u0900-\u097F]))?/g;
  for (const m of s.matchAll(re)) {
    const unit = m[3];
    let n = Number(m[2]);
    const money = Boolean(m[1]) || (unit !== undefined && /^(rupe|rupay|रुप|रु)/.test(unit));
    if (unit && !money) {
      if (/^(lakh|lac|लाख)/.test(unit)) n *= 100_000;
      else if (/^(k|haz|haj|हज)/.test(unit)) n *= 1000;
      else n *= 10_000_000;
    } else if (!money && n < 1000) continue;
    return Math.round(n * 100);
  }
  return null;
}
