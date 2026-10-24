import { groupIndian } from '@/lib/money/paise';
import type { Lang } from '@/features/collect/templates';

/** Short rupee text for the brief: ₹2.1L, ₹1.2Cr, ₹85,000. Input is integer paise. */
export function formatLakh(paise: number): string {
  const rupees = Math.round(paise / 100);
  if (rupees >= 10_000_000) return `₹${trim(rupees / 10_000_000)}Cr`;
  if (rupees >= 100_000) return `₹${trim(rupees / 100_000)}L`;
  return `₹${groupIndian(rupees)}`;
}
function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export interface BriefFacts {
  business: string;
  toChase: number;
  needApproval: number;
  autoSent: number;
  failed: number;
  amountPaise: number;
  shortfallWeek: number | null;
  approveUrl: string | null;
  openUrl: string;
  testMode: boolean;
}

const L: Record<Lang, Record<string, string>> = {
  en: {
    chase: '{n} to chase today',
    none: 'Nothing to chase today',
    risk: 'shortfall risk week {w}',
    ok: 'no cash shortfall expected',
    approve: 'Approve all {n}',
    open: 'Open Today',
    auto: '{n} sent automatically',
    failed: '{n} failed (retry in Today)',
    test: 'Test mode is on: customer messages go to you, not to customers.',
    waiting: '{n} waiting for your approval',
  },
  hi: {
    chase: 'आज {n} जगह वसूली करनी है',
    none: 'आज वसूली के लिए कुछ नहीं है',
    risk: 'सप्ताह {w} में नकदी की कमी का जोखिम',
    ok: 'नकदी की कमी की संभावना नहीं',
    approve: 'सभी {n} मंज़ूर करें',
    open: 'आज का पेज खोलें',
    auto: '{n} अपने आप भेजे गए',
    failed: '{n} विफल (आज में दोबारा कोशिश करें)',
    test: 'टेस्ट मोड चालू है: ग्राहकों के संदेश आपको मिलते हैं, ग्राहकों को नहीं।',
    waiting: '{n} आपकी मंज़ूरी का इंतज़ार कर रहे हैं',
  },
  mr: {
    chase: 'आज {n} जणांकडून वसुली करायची आहे',
    none: 'आज वसुलीसाठी काही नाही',
    risk: 'आठवडा {w} मध्ये रोख तुटवड्याचा धोका',
    ok: 'रोख तुटवडा अपेक्षित नाही',
    approve: 'सर्व {n} मंजूर करा',
    open: 'आजचे पान उघडा',
    auto: '{n} आपोआप पाठवले',
    failed: '{n} अयशस्वी (आज मध्ये पुन्हा प्रयत्न करा)',
    test: 'टेस्ट मोड चालू आहे: ग्राहकांचे संदेश तुम्हाला येतात, ग्राहकांना नाही.',
    waiting: '{n} तुमच्या मंजुरीची वाट पाहत आहेत',
  },
};
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? ''));

export function buildBrief(
  f: BriefFacts,
  lang: Lang,
): { subject: string; text: string; html: string } {
  const t = L[lang] ?? L.en;
  const head =
    f.toChase > 0 ? `${fill(t.chase!, { n: f.toChase })}, ${formatLakh(f.amountPaise)}` : t.none!;
  const risk = f.shortfallWeek ? fill(t.risk!, { w: f.shortfallWeek }) : t.ok!;
  const subject = `${head}, ${risk}`;
  const lines = [subject + '.'];
  if (f.needApproval > 0) lines.push(fill(t.waiting!, { n: f.needApproval }));
  if (f.autoSent > 0) lines.push(fill(t.auto!, { n: f.autoSent }));
  if (f.failed > 0) lines.push(fill(t.failed!, { n: f.failed }));
  if (f.testMode) lines.push(t.test!);
  const text = [
    ...lines,
    '',
    f.approveUrl ? `${fill(t.approve!, { n: f.needApproval })}: ${f.approveUrl}` : '',
    `${t.open}: ${f.openUrl}`,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html =
    `<p><strong>${esc(f.business)}</strong></p>` +
    lines.map((l) => `<p>${esc(l)}</p>`).join('') +
    (f.approveUrl
      ? `<p><a href="${esc(f.approveUrl)}">${esc(fill(t.approve!, { n: f.needApproval }))}</a></p>`
      : '') +
    `<p><a href="${esc(f.openUrl)}">${esc(t.open!)}</a></p>`;
  return { subject, text, html };
}

// ---- Signed, expiring approval tokens (HMAC-SHA256, Web Crypto) ------------------------------

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export interface ApprovalClaims {
  org: string;
  day: string; // plan day (IST date) the approval covers
  exp: number; // epoch seconds
}

export async function signApproval(c: ApprovalClaims, secret: string): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(c)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyApproval(
  token: string,
  secret: string,
  nowSec: number,
): Promise<ApprovalClaims | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = await hmac(secret, body);
  if (expect.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const c = JSON.parse(new TextDecoder().decode(unb64u(body))) as ApprovalClaims;
    if (typeof c.org !== 'string' || typeof c.day !== 'string' || typeof c.exp !== 'number')
      return null;
    return c.exp >= nowSec ? c : null;
  } catch {
    return null;
  }
}
