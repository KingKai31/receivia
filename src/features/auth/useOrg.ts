import { useQuery } from '@tanstack/react-query';
import { isRole, type Role } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

export interface CurrentOrg {
  orgId: string;
  orgName: string;
  role: Role;
}

/** The signed-in user's business. RLS limits memberships to the user's own orgs. */
export function useOrg() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['current-org', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CurrentOrg | null> => {
      const { data, error } = await supabase
        .from('memberships')
        .select('org_id, role, orgs(name)')
        .eq('user_id', userId!)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data || !isRole(data.role)) return null;
      const org = data.orgs as unknown as { name: string } | null;
      return { orgId: data.org_id, orgName: org?.name ?? '', role: data.role };
    },
  });
}
