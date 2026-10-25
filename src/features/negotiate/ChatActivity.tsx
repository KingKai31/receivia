import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useOrg } from '@/features/auth/useOrg';
import { supabase } from '@/lib/supabase';

interface Row {
  id: string;
  tool: string;
  content: string;
  created_at: string;
  invoice_id: string;
  customer_id: string | null;
}

/** What the buyer chat did on your behalf, newest first. Instalment plans still need your approval. */
export function ChatActivity() {
  const { t } = useTranslation();
  const orgId = useOrg().data?.orgId;
  const q = useQuery({
    queryKey: ['chat-activity', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await supabase
        .from('negotiation_log')
        .select('id, tool, content, created_at, invoice_id, customer_id')
        .eq('org_id', orgId!)
        .eq('role', 'tool')
        .eq('ok', true)
        .neq('tool', 'answer_invoice_question')
        .order('created_at', { ascending: false })
        .limit(20);
      if (res.error) throw res.error;
      return res.data as Row[];
    },
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <section>
      <h2>{t('From the buyer chat ({{length}})', { length: q.data.length })}</h2>
      <ul>
        {q.data.map((r) => (
          <li key={r.id}>
            {new Date(r.created_at).toLocaleDateString('en-IN')} ·{' '}
            <Link to={`/invoices/${r.invoice_id}`}>{t('Invoice')}</Link>: {r.content}
            {r.tool === 'offer_instalments' && r.customer_id ? (
              <>
                {' '}
                <Link to={`/customers/${r.customer_id}`}>{t('Review the plan')}</Link>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
