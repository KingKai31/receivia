export type VoiceLang = 'en' | 'hi' | 'mr';

export const SPEECH_TAG: Record<VoiceLang, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

export interface VoiceFacts {
  toChase: number;
  amountPaise: number;
  shortfallWeek: number | null;
}

const WORDS: Record<VoiceLang, { cr: string; lakh: string; rupees: string }> = {
  en: { cr: 'crore rupees', lakh: 'lakh rupees', rupees: 'rupees' },
  hi: { cr: 'करोड़ रुपये', lakh: 'लाख रुपये', rupees: 'रुपये' },
  mr: { cr: 'कोटी रुपये', lakh: 'लाख रुपये', rupees: 'रुपये' },
};
const trim1 = (n: number) => String(Math.round(n * 10) / 10);

/** "2.1 लाख रुपये": the speech engine reads digits in the voice's own language. */
export function spokenAmount(paise: number, lang: VoiceLang): string {
  const w = WORDS[lang];
  const r = Math.round(paise / 100);
  if (r >= 10_000_000) return `${trim1(r / 10_000_000)} ${w.cr}`;
  if (r >= 100_000) return `${trim1(r / 100_000)} ${w.lakh}`;
  return `${r} ${w.rupees}`;
}

const SAY: Record<VoiceLang, { chase: string; none: string; risk: string; ok: string }> = {
  en: {
    chase: '{n} to chase today, about {amt}.',
    none: 'Nothing to chase today.',
    risk: 'Cash may run short in week {w}.',
    ok: 'No cash shortfall is expected.',
  },
  hi: {
    chase: 'आज {n} जगह वसूली करनी है, लगभग {amt}।',
    none: 'आज वसूली के लिए कुछ नहीं है।',
    risk: 'सप्ताह {w} में नकदी कम पड़ सकती है।',
    ok: 'नकदी की कमी की संभावना नहीं है।',
  },
  mr: {
    chase: 'आज {n} जणांकडून वसुली करायची आहे, सुमारे {amt}.',
    none: 'आज वसुलीसाठी काही नाही.',
    risk: 'आठवडा {w} मध्ये रोख कमी पडू शकते.',
    ok: 'रोख तुटवडा अपेक्षित नाही.',
  },
};

/** The daily brief as plain sentences for the speech engine (numbers come from the same data as the page). */
export function spokenBrief(f: VoiceFacts, lang: VoiceLang): string {
  const s = SAY[lang] ?? SAY.en;
  const head =
    f.toChase > 0
      ? s.chase
          .replace('{n}', String(f.toChase))
          .replace('{amt}', spokenAmount(f.amountPaise, lang))
      : s.none;
  const risk = f.shortfallWeek ? s.risk.replace('{w}', String(f.shortfallWeek)) : s.ok;
  return `${head} ${risk}`;
}

export const asVoiceLang = (l: string): VoiceLang => (l === 'hi' || l === 'mr' ? l : 'en');

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance === 'function'
    ? window.speechSynthesis
    : null;
}

/** A voice for this language exists (voices may load late: call again on `voiceschanged`). */
export function voiceFor(lang: VoiceLang): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const tag = SPEECH_TAG[lang].toLowerCase();
  const voices = s.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().replace('_', '-') === tag) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ??
    null
  );
}

export function speak(text: string, lang: VoiceLang, onEnd: () => void): boolean {
  const s = synth();
  if (!s) return false;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_TAG[lang];
  const v = voiceFor(lang);
  if (v) u.voice = v;
  u.onend = onEnd;
  u.onerror = onEnd;
  s.speak(u);
  return true;
}

export const stopSpeaking = () => synth()?.cancel();
