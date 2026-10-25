import { useTranslation } from 'react-i18next';
import { asVoiceLang, canListen, listenOnce, speak, stopSpeaking, voiceFor } from './voice';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, GlassCard, Input, Skeleton, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { errorMessage } from '@/lib/service/errors';
import { askBooksRemote } from './aiService';
import type { Answer } from './books';

const CHIPS = ['Who owes me most from Gujarat?', 'Will I manage salaries?'];

/** A question box over the owner's own books. Answers are rendered from read-only tool results. */
export function AskBooks() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const org = useOrg();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const lang = asVoiceLang(i18n.language);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const spoken = useRef(false); // true when the current question was asked by voice
  const stop = useRef<(() => void) | null>(null);
  const [micOk] = useState(canListen);
  useEffect(
    () => () => {
      stop.current?.();
      stopSpeaking();
    },
    [],
  );
  const ask = useMutation({
    mutationFn: (question: string) => askBooksRemote(org.data!.orgId, question),
    onSuccess: (a) => {
      setAnswer(a);
      // A question asked by voice is answered aloud when the browser has a voice for the language.
      if (spoken.current && voiceFor(lang))
        setSpeaking(speak(a.text, lang, () => setSpeaking(false)));
      spoken.current = false;
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const go = (question: string) => {
    setQ(question);
    setAnswer(null);
    ask.mutate(question);
  };
  return (
    <GlassCard variant="solid" style={{ padding: 18, marginBottom: 16 }}>
      <h2>{t('Ask your books')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(q);
        }}
      >
        <Input
          label="Ask a question about your invoices or cash"
          value={q}
          maxLength={400}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={ask.isPending || !q.trim() || !org.data}>
            {t('Ask')}
          </Button>
          {micOk ? (
            <Button
              variant="ghost"
              aria-pressed={listening}
              disabled={ask.isPending || !org.data}
              onClick={() => {
                if (listening) {
                  stop.current?.();
                  return;
                }
                stopSpeaking();
                setListening(true);
                stop.current = listenOnce(
                  lang,
                  (text) => {
                    spoken.current = true;
                    go(text);
                  },
                  () => setListening(false),
                );
                if (!stop.current) setListening(false);
              }}
            >
              {listening ? t('Listening…') : t('Speak')}
            </Button>
          ) : null}
          {CHIPS.map((c) => (
            <Button
              key={c}
              variant="ghost"
              disabled={ask.isPending || !org.data}
              onClick={() => go(c)}
            >
              {t(c)}
            </Button>
          ))}
        </div>
      </form>
      {ask.isPending ? (
        <div aria-live="polite">
          <p className="ui-hint">{t('Looking through your books…')}</p>
          <Skeleton rows={1} />
        </div>
      ) : null}
      {answer && !ask.isPending ? (
        <div className="seq" aria-live="polite">
          <p>{answer.text}</p>
          {voiceFor(lang) ? (
            <Button
              variant="ghost"
              aria-pressed={speaking}
              onClick={() => {
                if (speaking) {
                  stopSpeaking();
                  setSpeaking(false);
                } else setSpeaking(speak(answer.text, lang, () => setSpeaking(false)));
              }}
            >
              {speaking ? t('Stop') : t('Read aloud')}
            </Button>
          ) : null}
          {answer.cites.length ? (
            <p className="ui-hint">
              {t('Based on')}: {answer.cites.map((c) => c.name.replace(/_/g, ' ')).join(', ')}
              {' · '}
              {answer.source === 'ai' ? t('Read by AI') : t('Read by simple rules')}
            </p>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
