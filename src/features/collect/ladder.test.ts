import { describe, expect, it } from 'vitest';
import { addDays } from '@/lib/dates';
import {
  DEFAULT_LADDER, STAGES, nextAction, nextStepsGuide, validateLadder,
  type LadderInput, type Stage,
} from './ladder';
import {
  SLOTS, TEMPLATES, TemplateError, buildMessage, canSend, renderTemplate, whatsappUrl,
  type MessageStage, type SlotValues,
} from './templates';

const DUE = '2026-06-01';
const inv = { due_date: DUE, total_paise: 100000, paid_paise: 0, status: 'issued' as const };
const base = (over: Partial<LadderInput> = {}): LadderInput => ({
  invoice: inv, tier: 'standard', today: DUE, sentStages: [], hasOpenDispute: false, ...over,
});

/** Walks one invoice through every stage by moving the demo date; returns the table rows. */
function walk(tier: 'key' | 'standard', approve: boolean) {
  const sent: Stage[] = [];
  const rows: { day: number; date: string; action: string; stage: string }[] = [];
  for (let day = -5; day <= 50; day++) {
    const today = addDays(DUE, day);
    const d = nextAction(base({ today, tier, sentStages: sent, approvedStages: approve ? [...STAGES] : [] }));
    if (d.action === 'send') {
      sent.push(d.stage);
      rows.push({ day, date: today, action: 'send', stage: d.stage });
    } else if (d.action === 'needs_approval') {
      rows.push({ day, date: today, action: 'needs_approval', stage: d.stage });
    }
  }
  return { rows, sent };
}

describe('ladder', () => {
  it('walks one invoice through every stage on the configured days (demo-date table)', () => {
    const { rows } = walk('standard', false);
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows.map((r) => [r.day, r.stage])).toEqual([
      [-3, 'pre_due'], [0, 'due_today'], [7, 'overdue_firm'], [15, 'final'], [30, 'demand_letter'], [45, 'next_steps'],
    ]);
  });

  it('never repeats a stage', () => {
    const { rows } = walk('standard', false);
    const stages = rows.filter((r) => r.action === 'send').map((r) => r.stage);
    expect(new Set(stages).size).toBe(stages.length);
    expect(nextAction(base({ today: addDays(DUE, 10), sentStages: ['pre_due', 'due_today', 'overdue_firm'] })).action).toBe('none');
  });

  it('catch-up sends only the latest due stage and never goes back', () => {
    const d = nextAction(base({ today: addDays(DUE, 20), sentStages: [] }));
    expect(d).toMatchObject({ action: 'send', stage: 'final', callPrompt: true });
    expect(nextAction(base({ today: addDays(DUE, 20), sentStages: ['final'] })).action).toBe('none');
  });

  it('an open dispute pauses every stage', () => {
    for (const day of [-3, 0, 7, 15, 30, 45]) {
      expect(nextAction(base({ today: addDays(DUE, day), hasOpenDispute: true })).action).toBe('paused');
    }
  });

  it('an active promise pauses until the promised date, then resumes', () => {
    const promisedFor = addDays(DUE, 9);
    expect(nextAction(base({ today: addDays(DUE, 7), promisedFor, sentStages: ['pre_due', 'due_today'] })).action).toBe('paused');
    expect(nextAction(base({ today: promisedFor, promisedFor, sentStages: ['pre_due', 'due_today'] })).action).toBe('paused');
    expect(nextAction(base({ today: addDays(promisedFor, 1), promisedFor, sentStages: ['pre_due', 'due_today'] }))).toMatchObject({ action: 'send', stage: 'overdue_firm' });
  });

  it('part payment keeps the stage and updates the amount', () => {
    const a = nextAction(base({ today: addDays(DUE, 7), sentStages: ['pre_due', 'due_today'] }));
    const b = nextAction(base({ today: addDays(DUE, 7), sentStages: ['pre_due', 'due_today'], invoice: { ...inv, paid_paise: 40000, status: 'partially_paid' } }));
    expect(a).toMatchObject({ stage: 'overdue_firm', amountDue: 100000 });
    expect(b).toMatchObject({ stage: 'overdue_firm', amountDue: 60000 });
  });

  it('paid, draft and void invoices are left alone', () => {
    expect(nextAction(base({ invoice: { ...inv, paid_paise: 100000, status: 'paid' } })).action).toBe('none');
    expect(nextAction(base({ invoice: { ...inv, status: 'draft' } })).action).toBe('none');
    expect(nextAction(base({ invoice: { ...inv, status: 'void' } })).action).toBe('none');
  });

  it('key-tier customers stop at firm until the owner approves', () => {
    const { rows } = walk('key', false);
    expect(rows.filter((r) => r.action === 'send').map((r) => r.stage)).toEqual(['pre_due', 'due_today', 'overdue_firm']);
    expect(rows.some((r) => r.action === 'needs_approval' && r.stage === 'final')).toBe(true);
    const ok = walk('key', true);
    expect(ok.sent).toEqual([...STAGES]);
  });

  it('uses edited stage days and validates them', () => {
    const cfg = { ...DEFAULT_LADDER, overdue_firm: 5 };
    expect(nextAction(base({ today: addDays(DUE, 5), config: cfg, sentStages: ['pre_due', 'due_today'] }))).toMatchObject({ stage: 'overdue_firm' });
    expect(validateLadder(DEFAULT_LADDER)).toBeNull();
    expect(validateLadder({ ...DEFAULT_LADDER, final: 3 })).toMatch(/must come after/);
    expect(validateLadder({ ...DEFAULT_LADDER, final: 1.5 })).toMatch(/whole number/);
  });

  it('next steps mention Samadhaan only for eligible suppliers', () => {
    expect(nextStepsGuide(true).join(' ')).toContain('Samadhaan');
    expect(nextStepsGuide(false).join(' ')).not.toContain('Samadhaan');
    expect(nextStepsGuide(false).join(' ')).toContain('lawyer');
  });
});

describe('templates and send rules', () => {
  const values: SlotValues = {
    customer: 'Acme', invoice_no: 'INV/26-27/0001', amount_due: '₹1,000.00', due_date: '2026-06-01',
    days_overdue: '7', pay_link: 'https://x/pay/t', lens_line: '', contact: 'Call 98xxxxxx00',
  };
  const stages = Object.keys(TEMPLATES) as MessageStage[];

  it('every stage x language uses only known slots and renders fully', () => {
    for (const s of stages) {
      for (const l of ['en', 'hi', 'mr'] as const) {
        const raw = TEMPLATES[s][l];
        for (const m of raw.matchAll(/\{\{(\w+)\}\}/g)) expect(SLOTS).toContain(m[1]);
        const out = buildMessage(s, l, values);
        expect(out).not.toMatch(/\{\{|\}\}/);
        expect(out).toContain('Acme');
        expect(out).toContain('INV/26-27/0001');
      }
    }
  });
  it('empty lens line leaves no blank line; filled lens line appears', () => {
    expect(buildMessage('overdue_firm', 'en', values)).not.toMatch(/\n\n/);
    expect(buildMessage('final', 'en', { ...values, lens_line: 'LENS TEXT' })).toContain('LENS TEXT');
  });
  it('no template contains forbidden wording', () => {
    for (const s of stages) for (const l of ['en', 'hi', 'mr'] as const) expect(TEMPLATES[s][l].toLowerCase()).not.toContain('legal notice');
  });
  it('unknown slot throws', () => {
    expect(() => renderTemplate('Hi {{nope}}', values)).toThrow(TemplateError);
  });
  it('quiet hours 21:00-09:00 IST and one message per customer per day', () => {
    const at = (h: number) => new Date(`2026-06-10T${String(h).padStart(2, '0')}:00:00+05:30`);
    expect(canSend({ now: at(8), sentTodayToCustomer: 0 }).ok).toBe(false);
    expect(canSend({ now: at(9), sentTodayToCustomer: 0 }).ok).toBe(true);
    expect(canSend({ now: at(20), sentTodayToCustomer: 0 }).ok).toBe(true);
    expect(canSend({ now: at(21), sentTodayToCustomer: 0 }).ok).toBe(false);
    expect(canSend({ now: at(12), sentTodayToCustomer: 1 }).ok).toBe(false);
  });
  it('wa.me adds 91 to 10-digit numbers and encodes text', () => {
    expect(whatsappUrl('98200 12345', 'a b')).toBe('https://wa.me/919820012345?text=a%20b');
  });
});
