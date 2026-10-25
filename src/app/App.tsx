import { Suspense, lazy, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary, Loading, ToastProvider } from '@/components/ui';
import { useLocation } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { Layout } from './Layout';
import { Field } from './Field';
import './i18n';

const ApprovePage = lazy(() =>
  import('@/features/agent/ApprovePage').then((m) => ({ default: m.ApprovePage })),
);
const SignInPage = lazy(() =>
  import('@/features/auth/SignInPage').then((m) => ({ default: m.SignInPage })),
);
const StatementPage = lazy(() =>
  import('@/features/pay/StatementPage').then((m) => ({ default: m.StatementPage })),
);
const PayPage = lazy(() => import('@/features/pay/PayPage').then((m) => ({ default: m.PayPage })));
const CustomerDetailPage = lazy(() =>
  import('@/features/customers/CustomerDetailPage').then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const CustomerFormPage = lazy(() =>
  import('@/features/customers/CustomerFormPage').then((m) => ({ default: m.CustomerFormPage })),
);
const CustomersPage = lazy(() =>
  import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
);
const InvoiceDocPage = lazy(() =>
  import('@/features/documents/DocPages').then((m) => ({ default: m.InvoiceDocPage })),
);
const NoteDocPage = lazy(() =>
  import('@/features/documents/DocPages').then((m) => ({ default: m.NoteDocPage })),
);
const CaseDocPage = lazy(() =>
  import('@/features/documents/CollectionDocPages').then((m) => ({ default: m.CaseDocPage })),
);
const LetterDocPage = lazy(() =>
  import('@/features/documents/CollectionDocPages').then((m) => ({ default: m.LetterDocPage })),
);
const ExpensesPage = lazy(() =>
  import('@/features/forecast/ExpensesPage').then((m) => ({ default: m.ExpensesPage })),
);
const ForecastPage = lazy(() =>
  import('@/features/forecast/ForecastPage').then((m) => ({ default: m.ForecastPage })),
);
const TodayPage = lazy(() =>
  import('@/features/today/TodayPage').then((m) => ({ default: m.TodayPage })),
);
const InboxPage = lazy(() =>
  import('@/features/inbox/InboxPage').then((m) => ({ default: m.InboxPage })),
);
const PaymentsPage = lazy(() =>
  import('@/features/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage })),
);
const TdsPage = lazy(() =>
  import('@/features/payments/TdsPage').then((m) => ({ default: m.TdsPage })),
);
const CollectTodayPage = lazy(() =>
  import('@/features/collect/CollectTodayPage').then((m) => ({ default: m.CollectTodayPage })),
);
const ImportPage = lazy(() =>
  import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const InvoiceDetailPage = lazy(() =>
  import('@/features/invoices/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage })),
);
const InvoiceFormPage = lazy(() =>
  import('@/features/invoices/InvoiceFormPage').then((m) => ({ default: m.InvoiceFormPage })),
);
const InvoicesPage = lazy(() =>
  import('@/features/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage })),
);
const NoteFormPage = lazy(() =>
  import('@/features/notes/NoteFormPage').then((m) => ({ default: m.NoteFormPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const StubPage = lazy(() =>
  import('@/features/shared/StubPage').then((m) => ({ default: m.StubPage })),
);
const TrustPage = lazy(() =>
  import('@/features/trust/TrustPage').then((m) => ({ default: m.TrustPage })),
);
const NationalImpactPage = lazy(() =>
  import('@/features/impact/NationalImpactPage').then((m) => ({ default: m.NationalImpactPage })),
);
const ScanInvoicePage = lazy(() =>
  import('@/features/invoices/scan/ScanInvoicePage').then((m) => ({ default: m.ScanInvoicePage })),
);
const HowItWorksPage = lazy(() =>
  import('@/features/howitworks/HowItWorksPage').then((m) => ({ default: m.HowItWorksPage })),
);
const PrivacyPage = lazy(() =>
  import('@/features/privacy/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
);

/** One boundary per route so a crash stays on its screen, plus a loading state for the lazy chunk. */
function Guard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Field />
            <Routes>
              <Route
                path="/sign-in"
                element={
                  <Guard>
                    <SignInPage />
                  </Guard>
                }
              />
              <Route
                path="/pay/statement/:token"
                element={
                  <Guard>
                    <StatementPage />
                  </Guard>
                }
              />
              <Route
                path="/pay/:token"
                element={
                  <Guard>
                    <PayPage />
                  </Guard>
                }
              />
              <Route
                path="/approve"
                element={
                  <Guard>
                    <ApprovePage />
                  </Guard>
                }
              />
              <Route
                path="/privacy"
                element={
                  <Guard>
                    <PrivacyPage />
                  </Guard>
                }
              />
              <Route
                path="/how-it-works"
                element={
                  <Guard>
                    <HowItWorksPage />
                  </Guard>
                }
              />
              <Route
                path="/impact"
                element={
                  <Guard>
                    <NationalImpactPage />
                  </Guard>
                }
              />
              <Route
                path="/trust"
                element={
                  <Guard>
                    <TrustPage />
                  </Guard>
                }
              />
              <Route element={<RequireAuth />}>
                <Route
                  path="/doc/invoice/:id"
                  element={
                    <Guard>
                      <InvoiceDocPage />
                    </Guard>
                  }
                />
                <Route
                  path="/doc/note/:id"
                  element={
                    <Guard>
                      <NoteDocPage />
                    </Guard>
                  }
                />
                <Route
                  path="/doc/letter/:id"
                  element={
                    <Guard>
                      <LetterDocPage />
                    </Guard>
                  }
                />
                <Route
                  path="/doc/case/:customerId"
                  element={
                    <Guard>
                      <CaseDocPage />
                    </Guard>
                  }
                />
                <Route element={<Layout />}>
                  <Route
                    index
                    element={
                      <Guard>
                        <TodayPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/invoices"
                    element={
                      <Guard>
                        <InvoicesPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/invoices/scan"
                    element={
                      <Guard>
                        <ScanInvoicePage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/invoices/new"
                    element={
                      <Guard>
                        <InvoiceFormPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/invoices/:id"
                    element={
                      <Guard>
                        <InvoiceDetailPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/invoices/:id/edit"
                    element={
                      <Guard>
                        <InvoiceFormPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/invoices/:id/notes/new"
                    element={
                      <Guard>
                        <NoteFormPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/customers"
                    element={
                      <Guard>
                        <CustomersPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/customers/new"
                    element={
                      <Guard>
                        <CustomerFormPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/customers/:id"
                    element={
                      <Guard>
                        <CustomerDetailPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/customers/:id/edit"
                    element={
                      <Guard>
                        <CustomerFormPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/import"
                    element={
                      <Guard>
                        <ImportPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/collect"
                    element={
                      <Guard>
                        <CollectTodayPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/inbox"
                    element={
                      <Guard>
                        <InboxPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/payments"
                    element={
                      <Guard>
                        <PaymentsPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/payments/tds"
                    element={
                      <Guard>
                        <TdsPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/forecast"
                    element={
                      <Guard>
                        <ForecastPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/expenses"
                    element={
                      <Guard>
                        <ExpensesPage />
                      </Guard>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <Guard>
                        <SettingsPage />
                      </Guard>
                    }
                  />
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
