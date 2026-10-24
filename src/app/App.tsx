import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { SignInPage } from '@/features/auth/SignInPage';
import { PayPage } from '@/features/pay/PayPage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { CustomerFormPage } from '@/features/customers/CustomerFormPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { InvoiceDocPage, NoteDocPage } from '@/features/documents/DocPages';
import { CaseDocPage, LetterDocPage } from '@/features/documents/CollectionDocPages';
import { InboxPage } from '@/features/inbox/InboxPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { TdsPage } from '@/features/payments/TdsPage';
import { CollectTodayPage } from '@/features/collect/CollectTodayPage';
import { ImportPage } from '@/features/import/ImportPage';
import { InvoiceDetailPage } from '@/features/invoices/InvoiceDetailPage';
import { InvoiceFormPage } from '@/features/invoices/InvoiceFormPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { NoteFormPage } from '@/features/notes/NoteFormPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { StubPage } from '@/features/shared/StubPage';
import { TrustPage } from '@/features/trust/TrustPage';
import { Layout } from './Layout';
import './i18n';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/pay/:token" element={<PayPage />} />
              <Route path="/trust" element={<TrustPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/doc/invoice/:id" element={<InvoiceDocPage />} />
                <Route path="/doc/note/:id" element={<NoteDocPage />} />
                <Route path="/doc/letter/:id" element={<LetterDocPage />} />
                <Route path="/doc/case/:customerId" element={<CaseDocPage />} />
                <Route element={<Layout />}>
                  <Route index element={<StubPage titleKey="pages.today" />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/invoices/new" element={<InvoiceFormPage />} />
                  <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
                  <Route path="/invoices/:id/edit" element={<InvoiceFormPage />} />
                  <Route path="/invoices/:id/notes/new" element={<NoteFormPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/new" element={<CustomerFormPage />} />
                  <Route path="/customers/:id" element={<CustomerDetailPage />} />
                  <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
                  <Route path="/import" element={<ImportPage />} />
                  <Route path="/collect" element={<CollectTodayPage />} />
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/payments" element={<PaymentsPage />} />
                  <Route path="/payments/tds" element={<TdsPage />} />
                  <Route path="/forecast" element={<StubPage titleKey="pages.forecast" />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<StubPage titleKey="pages.emptyTitle" />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
