import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import replies from './replies.json';
import questions from './questions.json';
import { SNAPSHOT, TODAY } from './fixture';
import { askBooks } from '@/features/ai/books';
import { classifyReply, type OpenInv } from '@/features/ai/reply';

const key = process.env.ANTHROPIC_API_KEY ?? null;
const INV: OpenInv[] = [{ id: 'i1', number: 'INV/26-27/0012', balancePaise: 5_000_000 }];

// On demand: LIVE_AI=1 npx vitest run tests/ai-evals/live.test.ts
describe.skipIf(!process.env.LIVE_AI || !key)('live model eval', () => {
  it('reports accuracy', { timeout: 300_000 }, async () => {
    let intent = 0;
    let full = 0;
    let model = 0;
    for (const r of replies) {
      const g = await classifyReply(r.text, INV, TODAY, { anthropicKey: key });
      if (g.source === 'ai') model++;
      const wantAmt = 'amount' in r ? (r as { amount: number }).amount * 100 : null;
      const wantDate = 'date' in r ? (r as { date: string }).date : null;
      if (g.intent === r.intent) intent++;
      if (g.intent === r.intent && g.date === wantDate && g.amountPaise === wantAmt) full++;
    }
    let qok = 0;
    let qmodel = 0;
    for (const c of questions) {
      const a = await askBooks(c.q, SNAPSHOT, { anthropicKey: key });
      if (a.source === 'ai') qmodel++;
      if (a.text.includes(c.contains) && (a.cites[0]?.name ?? null) === c.tool) qok++;
    }
    const out = {
      replies: replies.length,
      intent,
      full,
      modelUsed: model,
      questions: questions.length,
      qok,
      qmodel,
    };
    fs.writeFileSync('tests/ai-evals/live-report.json', JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out));
    expect(model + qmodel).toBeGreaterThan(0);
  });
});
