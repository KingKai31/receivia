import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { todayIST } from '@/lib/dates';
import { parseRupees } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import { saveForecastSettings } from './forecastService';
import { useForecast } from './useForecast';

function toPaise(v: string): number | null {
  try {
    const p = Number(parseRupees(v || '0'));
    return p >= 0 ? p : null;
  } catch {
    return null;
  }
}

/** Opening bank balance and safety buffer: the two numbers the forecast starts from. */
export function ForecastSettings() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const { ctx } = useForecast();
  const [balance, setBalance] = useState('');
  const [on, setOn] = useState('');
  const [buffer, setBuffer] = useState('');
  useEffect(() => {
    if (!ctx) return;
    setBalance(String(ctx.openingBalancePaise / 100));
    setOn(ctx.openingBalanceOn ?? '');
    setBuffer(String(ctx.bufferPaise / 100));
  }, [ctx]);
  const bal = toPaise(balance);
  const buf = toPaise(buffer);
  const canEdit = org.data?.role === 'owner';
  const save = useMutation({
    mutationFn: () =>
      saveForecastSettings(ctx!.profile, {
        opening_balance_paise: bal!,
        opening_balance_on: on || todayIST(),
        safety_buffer_paise: buf!,
      }),
    onSuccess: () => {
      toast.show('Saved.');
      void qc.invalidateQueries({ queryKey: ['forecast-ctx'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  if (!ctx) return null;
  return (
    <Card>
      <h2>Cash settings</h2>
      <p>
        The forecast starts from your bank balance today and warns when cash is expected to fall
        below the buffer.
      </p>
      <Input
        label="Bank balance (₹)"
        value={balance}
        disabled={!canEdit}
        error={bal === null ? 'Enter an amount in rupees' : undefined}
        onChange={(e) => setBalance(e.target.value)}
      />
      <Input
        label="Balance as of"
        type="date"
        value={on}
        disabled={!canEdit}
        onChange={(e) => setOn(e.target.value)}
      />
      <Input
        label="Safety buffer (₹)"
        value={buffer}
        disabled={!canEdit}
        error={buf === null ? 'Enter an amount in rupees' : undefined}
        onChange={(e) => setBuffer(e.target.value)}
      />
      {canEdit ? (
        <Button
          disabled={bal === null || buf === null || save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      ) : (
        <p>Only the owner can change these.</p>
      )}
    </Card>
  );
}
