import type { ChaseItem } from '@/lib/forecast';

/**
 * Orders Collect groups by the best chase score among their invoices (highest first). Groups with
 * no score keep their original relative order, after the scored ones.
 */
export function rankGroups<T extends { items: { invoice: { id: string } }[] }>(
  groups: T[],
  chase: ChaseItem[],
): T[] {
  const byInvoice = new Map(chase.map((c) => [c.invoiceId, c.score]));
  const best = (g: T) => Math.max(-1, ...g.items.map((i) => byInvoice.get(i.invoice.id) ?? -1));
  return groups
    .map((g, idx) => ({ g, idx, s: best(g) }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => x.g);
}

/** Reason lines per invoice id, for display next to each invoice. */
export function reasonByInvoice(chase: ChaseItem[]): Map<string, string> {
  return new Map(chase.map((c) => [c.invoiceId, c.reason]));
}
