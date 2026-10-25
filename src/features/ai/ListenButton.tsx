import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { asVoiceLang, speak, spokenBrief, stopSpeaking, voiceFor, type VoiceFacts } from './voice';

/** Reads the daily brief aloud in the app language. Hidden when the browser has no voice for it. */
export function ListenButton({ facts }: { facts: VoiceFacts }) {
  const { t, i18n } = useTranslation();
  const lang = asVoiceLang(i18n.language);
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const check = () => setAvailable(voiceFor(lang) !== null);
    check();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.addEventListener?.('voiceschanged', check);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', check);
      stopSpeaking();
    };
  }, [lang]);

  if (!available) return null;
  return (
    <Button
      variant="ghost"
      aria-pressed={playing}
      onClick={() => {
        if (playing) {
          stopSpeaking();
          setPlaying(false);
          return;
        }
        setPlaying(speak(spokenBrief(facts, lang), lang, () => setPlaying(false)));
      }}
    >
      {playing ? t('Stop') : t('Listen')}
    </Button>
  );
}
