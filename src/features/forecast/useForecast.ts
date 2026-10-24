import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/features/auth/useOrg';
import { todayIST } from '@/lib/dates';
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
  const computed = useMemo(
    () => (q.data ? compute(q.data, { includeDisputed }) : undefined),
    [q.data, includeDisputed],
  );
  return {
    ctx: q.data,
    computed,
    isLoading: q.isLoading || org.isLoading,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}
