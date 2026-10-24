import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pill, type PillTone } from './display';

const TONES: Record<string, PillTone> = {
  overdue: 'overdue',
  failed: 'overdue',
  rejected: 'overdue',
  disputed: 'overdue',
  'due soon': 'due',
  proposed: 'due',
  approved: 'peach',
  'part paid': 'peach',
  paid: 'paid',
  sent: 'paid',
  pass: 'paid',
};

/** Status is always conveyed with words; colour only reinforces them. Changes crossfade. */
export function Badge({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const raw = typeof children === 'string' ? children : '';
  const text = raw ? t(raw) : children;
  return (
    <Pill tone={TONES[raw.toLowerCase()] ?? 'neutral'}>
      <span key={raw} className="soft-in">
        {text}
      </span>
    </Pill>
  );
}
