import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/features/auth/useOrg';
import { todayIST } from '@/lib/dates';
import { loadSnapshot, saveSnapshot, type Snapshot } from '@/lib/offline';
import {
  compute,
  loadForecastContext,
  type Computed,
  type ForecastContext,
} from './forecastService';

export interface UseForecast {
  ctx: ForecastContext | undefined;
  computed: Computed | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  /** When the numbers were fetched (ms since epoch). */
  updatedAt: number | null;
  /** True when the numbers are the saved copy because the network or server could not be reached. */
  offline: boolean;
}

/** Loads the forecast inputs once and computes the forecast locally (same inputs, same numbers). */
export function useForecast(includeDisputed = false): UseForecast {
  const org = useOrg();
  const orgId = org.data?.orgId;
  const today = todayIST();
  const q = useQuery({
    queryKey: ['forecast-ctx', orgId, today],
    enabled: Boolean(orgId),
    queryFn: () => loadForecastContext(orgId!, today),
  });
  const [saved, setSaved] = useState<Snapshot<ForecastContext> | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);
  useEffect(() => {
    void loadSnapshot<ForecastContext>().then((s) => {
      setSaved(s);
      setSavedChecked(true);
    });
  }, []);
  useEffect(() => {
    if (q.data && orgId) {
      void saveSnapshot({ orgId, today, savedAt: q.dataUpdatedAt, data: q.data });
    }
  }, [q.data, q.dataUpdatedAt, orgId, today]);

  // Live numbers win. The saved copy is used only when they cannot be loaded.
  const failed = Boolean(q.error) || Boolean(org.error) || (!q.data && !navigator.onLine);
  const fallback = !q.data && failed && saved && (!orgId || saved.orgId === orgId) ? saved : null;
  const ctx = q.data ?? fallback?.data;
  const computed = useMemo(
    () => (ctx ? compute(ctx, { includeDisputed }) : undefined),
    [ctx, includeDisputed],
  );
  const waiting = (q.isLoading || org.isLoading) && navigator.onLine;
  return {
    ctx,
    computed,
    isLoading: !ctx && (waiting || !savedChecked),
    error: ctx ? null : q.error,
    refetch: () => void q.refetch(),
    updatedAt: q.data ? q.dataUpdatedAt : (fallback?.savedAt ?? null),
    offline: Boolean(fallback),
  };
}
