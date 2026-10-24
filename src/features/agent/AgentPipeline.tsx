import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CountUp } from '@/components/ui';
import type { AgentAction, loadLastRun } from './agentService';

type LastRun = Awaited<ReturnType<typeof loadLastRun>>;

const STEPS = ['Plan', 'Draft', 'Check', 'Approve', 'Send', 'Log'] as const;

export interface PipelineCounts {
  drafted: number;
  blocked: number;
  waiting: number;
  sent: number;
}

export function pipelineCounts(actions: AgentAction[]): PipelineCounts {
  return {
    drafted: actions.filter((a) => a.draft_source !== null).length,
    blocked: actions.filter((a) => a.draft_note?.startsWith('draft rejected')).length,
    waiting: actions.filter((a) => a.status === 'proposed').length,
    sent: actions.filter((a) => a.status === 'sent').length,
  };
}

/**
 * Plan → Draft → Check → Approve → Send → Log. While a run is in flight the steps light up in
 * turn (the run is one server call, so the order is shown, the counters are live from the
 * polled actions). When it ends, every step is done and the counters are the final numbers.
 */
export function AgentPipeline({
  running,
  actions,
  last,
}: {
  running: boolean;
  actions: AgentAction[];
  last: LastRun;
}) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    setTick(0);
    const id = window.setInterval(() => setTick((n) => Math.min(n + 1, STEPS.length - 1)), 1600);
    return () => window.clearInterval(id);
  }, [running]);
  const finished = !running && last !== null;
  const state = (i: number) =>
    running
      ? i < tick
        ? 'done'
        : i === tick
          ? 'active'
          : 'pending'
      : finished
        ? 'done'
        : 'pending';
  const c = pipelineCounts(actions);
  const plain = (n: number) => String(n);
  return (
    <div aria-label={t('Agent pipeline')} role="group">
      <ol className="pipeline">
        {STEPS.map((s, i) => (
          <li key={s} className="pipe-step" data-state={state(i)}>
            <i aria-hidden="true" />
            {t(`pipe.${s}`)}
            <span className="sr-only"> {t(`pipe.state.${state(i)}`)}</span>
          </li>
        ))}
      </ol>
      <p className="num" role="status" aria-live="polite" style={{ margin: 0 }}>
        <CountUp value={c.drafted} format={plain} /> {t('drafted')},{' '}
        <CountUp value={c.blocked} format={plain} /> {t('blocked by safety check')},{' '}
        <CountUp value={c.waiting} format={plain} /> {t('awaiting approval')},{' '}
        <CountUp value={c.sent} format={plain} /> {t('sent')}
      </p>
    </div>
  );
}
