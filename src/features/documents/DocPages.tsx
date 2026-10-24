import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { Button, Loading } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getCustomer } from '@/features/customers/customerService';
import { getInvoice } from '@/features/invoices/invoiceService';
import { getNote } from '@/features/notes/noteService';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { todayIST } from '@/lib/dates';
import { errorMessage } from '@/lib/service/errors';
import {
  InvoiceDocument,
  NoteDocument,
  buildInvoiceDocument,
  buildNoteDocument,
} from './invoiceDocument';

function Toolbar({ back }: { back: string }) {
  const { t } = useTranslation();
  return (
    <div className="doc-toolbar">
      <Link to={back}>{t('Back')}</Link>
      <Button onClick={() => window.print()}>{t('Print or save as PDF')}</Button>
    </div>
  );
}

export function InvoiceDocPage() {
  const { id } = useParams();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const q = useQuery({
    queryKey: ['doc-invoice', id, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { invoice, lines } = await getInvoice(id!);
      const [supplier, buyer] = await Promise.all([
        getBusinessProfile(orgId!),
        getCustomer(invoice.customer_id),
      ]);
      const model = buildInvoiceDocument({ invoice, lines, supplier, buyer });
      const qr = model.upi
        ? await QRCode.toDataURL(model.upi, { margin: 1, width: 240 })
        : undefined;
      return { model, qr };
    },
  });
  if (q.isLoading || org.isLoading) return <Loading />;
  if (q.error) return <p role="alert">{errorMessage(q.error)}</p>;
  if (!q.data) return null;
  return (
    <>
      <Toolbar back={`/invoices/${id}`} />
      <InvoiceDocument model={q.data.model} qrDataUrl={q.data.qr} />
    </>
  );
}

export function NoteDocPage() {
  const { id } = useParams();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const q = useQuery({
    queryKey: ['doc-note', id, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const note = await getNote(id!);
      const { invoice } = await getInvoice(note.invoice_id);
      const [supplier, buyer] = await Promise.all([
        getBusinessProfile(orgId!),
        getCustomer(invoice.customer_id),
      ]);
      return buildNoteDocument({ note, invoice, supplier, buyer, today: todayIST() });
    },
  });
  if (q.isLoading || org.isLoading) return <Loading />;
  if (q.error) return <p role="alert">{errorMessage(q.error)}</p>;
  if (!q.data) return null;
  return (
    <>
      <Toolbar back="/invoices" />
      <NoteDocument model={q.data} />
    </>
  );
}
