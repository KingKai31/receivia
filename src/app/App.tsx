import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { SignInPage } from '@/features/auth/SignInPage';
import { PayPage } from '@/features/pay/PayPage';
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
                <Route element={<Layout />}>
                  <Route index element={<StubPage titleKey="pages.today" />} />
                  <Route path="/invoices" element={<StubPage titleKey="pages.invoices" />} />
                  <Route path="/customers" element={<StubPage titleKey="pages.customers" />} />
                  <Route path="/collect" element={<StubPage titleKey="pages.collect" />} />
                  <Route path="/payments" element={<StubPage titleKey="pages.payments" />} />
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
