import { MoneyError } from './errors';
import type { Paise } from './paise';

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t} ${ONES[n % 10]!}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]!} Hundred`);
  if (r) parts.push(below100(r));
  return parts.join(' ');
}

/** Indian grouping words for a non-negative integer (crore / lakh / thousand). */
function integerWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "Rupees One Lakh Eighteen Thousand Only"; paise as "... and Fifty Paise Only". */
export function amountInWordsIndian(p: Paise): string {
  if (p < 0) {
    throw new MoneyError('NEGATIVE_NOT_ALLOWED', 'Amount in words needs a non-negative amount');
  }
  const rupees = Math.floor(p / 100);
  const ps = p % 100;
  let out = `Rupees ${integerWords(rupees)}`;
  if (ps) out += ` and ${below100(ps)} Paise`;
  return `${out} Only`;
}
