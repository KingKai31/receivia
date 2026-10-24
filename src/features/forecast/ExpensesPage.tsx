import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Pager, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { formatINR, paise } from '@/lib/money';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import {
  EMPTY_EXPENSE,
  EXPENSE_KINDS,
  RECURRENCES,
  createExpense,
  deleteExpense,
  expenseSchema,
  listExpenses,
  rowToForm,
  setExpenseActive,
  updateExpense,
  type ExpenseForm,
} from './expenseService';
import type { ExpenseRow } from './forecastService';

function ExpenseEditor({
  initial,
  onCancel,
  onSave,
  busy,
}: {
  initial: ExpenseForm;
  onCancel: () => void;
  onSave: (f: ExpenseForm) => void;
  busy: boolean;
}) {
  const [f, setF] = useState<ExpenseForm>(initial);
  const parsed = expenseSchema.safeParse(f);
  const err = (k: string) =>
    parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === k)?.message;
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof ExpenseForm>(k: K, v: ExpenseForm[K]) => setF({ ...f, [k]: v });
  const recurring = f.recurrence !== '';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (parsed.success) onSave(parsed.data);
      }}
    >
      <Input
        label="Name"
        value={f.name}
        error={touched ? err('name') : undefined}
        onChange={(e) => set('name', e.target.value)}
      />
      <Select
        label="Type"
        value={f.kind}
        onChange={(e) => set('kind', e.target.value as ExpenseForm['kind'])}
        options={[...EXPENSE_KINDS]}
      />
      <Input
        label="Amount (₹)"
        value={f.amount}
        error={touched ? err('amount') : undefined}
        onChange={(e) => set('amount', e.target.value)}
      />
      <Select
        label="How often"
        value={f.recurrence}
        onChange={(e) => set('recurrence', e.target.value as ExpenseForm['recurrence'])}
        options={[...RECURRENCES]}
      />
      <Input
        label={recurring ? 'Next due date (the day of the month repeats)' : 'Due date'}
        type="date"
        value={f.date}
        error={touched ? err('date') : undefined}
        onChange={(e) => set('date', e.target.value)}
      />
      {recurring ? (
        <Input
          label="Stops on (optional)"
          type="date"
          value={f.endsOn}
          error={touched ? err('endsOn') : undefined}
          onChange={(e) => set('endsOn', e.target.value)}
        />
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={f.deferrable}
          onChange={(e) => set('deferrable', e.target.checked)}
        />{' '}
        Can be paid later if cash is tight (supplier bills)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ExpensesPage() {
  const org = useOrg();
  const orgId = org.data?.orgId;
  const canWrite = can.writeData(org.data?.role ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['expenses', orgId, page],
    enabled: Boolean(orgId),
    queryFn: () => listExpenses({ orgId: orgId!, page }),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['expenses'] });
    void qc.invalidateQueries({ queryKey: ['forecast-ctx'] });
  };
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  return (
    <>
      <h1>Expenses and bills</h1>
      <p>
        These feed the cash forecast: salaries on the 1st, rent on the 5th, GST on the 20th,
        supplier bills on their dates.
      </p>
      {canWrite ? <Button onClick={() => setEditing('new')}>Add an expense</Button> : null}
      {editing ? (
        <Card>
          <h2>{editing === 'new' ? 'New expense' : `Edit ${editing.name}`}</h2>
          <ExpenseEditor
            initial={editing === 'new' ? EMPTY_EXPENSE : rowToForm(editing)}
            busy={run.isPending}
            onCancel={() => setEditing(null)}
            onSave={(f) =>
              run.mutate(() =>
                editing === 'new' ? createExpense(orgId!, f) : updateExpense(editing, f),
              )
            }
          />
        </Card>
      ) : null}
      {q.isLoading ? <p>Loading…</p> : null}
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {q.data?.rows.length === 0 ? (
        <p>
          No expenses yet. Add salaries, rent, GST and supplier bills so the forecast knows what
          goes out.
        </p>
      ) : null}
      <ul className="tnum">
        {q.data?.rows.map((r) => (
          <li key={r.id}>
            <strong>{r.name}</strong> · {formatINR(paise(r.amount_paise))} ·{' '}
            {r.is_recurring
              ? `${r.recurrence}, next ${r.next_due ?? r.expense_date}`
              : `due ${r.expense_date}`}
            {r.ends_on ? `, stops ${r.ends_on}` : ''}
            {r.can_defer ? ' · can be paid later' : ''}
            {!r.active ? ' · switched off' : ''}
            {canWrite ? (
              <>
                {' '}
                <Button variant="secondary" onClick={() => setEditing(r)}>
                  Edit
                </Button>{' '}
                <Button
                  variant="secondary"
                  disabled={run.isPending}
                  onClick={() => run.mutate(() => setExpenseActive(r, !r.active))}
                >
                  {r.active ? 'Switch off' : 'Switch on'}
                </Button>{' '}
                <Button
                  variant="secondary"
                  disabled={run.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${r.name}?`))
                      run.mutate(() => deleteExpense(orgId!, r.id));
                  }}
                >
                  Delete
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pager
          page={q.data.page}
          pageSize={q.data.pageSize}
          total={q.data.total}
          onPage={setPage}
        />
      ) : null}
    </>
  );
}
