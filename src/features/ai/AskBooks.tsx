import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, GlassCard, Input, Skeleton, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { errorMessage } from '@/lib/service/errors';
import { askBooksRemote } from './aiService';
import type { Answer } from './books';

const CHIPS = ['Who owes me most from Gujarat?', 'Will I manage salaries?'];

/** A question box over the owner's own books. Answers are rendered from read-only tool results. */
export function AskBooks() {
  const { t } = useTranslation();
  const toast = useToast();
  const org = useOrg();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const ask = useMutation({
    mutationFn: (question: string) => askBooksRemote(org.data!.orgId, question),
    onSuccess: setAnswer,
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
          {CHIPS.map((c) => (
            <Button key={c} variant="ghost" disabled={ask.isPending || !org.data} onClick={() => go(c)}>
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
