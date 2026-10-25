import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, Input, LanguagePicker } from '@/components/ui';
import { useAuth } from './AuthProvider';
import { AuthFlowError, openLiveDemo, otpSchema, sendOtp, verifyOtp } from './authApi';

const emailForm = z.object({ email: z.string().trim().min(1) });
const codeForm = z.object({ code: otpSchema });

export function SignInPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emailRhf = useForm({ resolver: zodResolver(emailForm), defaultValues: { email: '' } });
  const codeRhf = useForm({ resolver: zodResolver(codeForm), defaultValues: { code: '' } });

  const dest = (location.state as { from?: string } | null)?.from ?? '/';
  if (session) return <Navigate to={dest} replace />;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrorCode(null);
    try {
      await action();
    } catch (e) {
      setErrorCode(e instanceof AuthFlowError ? e.code : 'OTP_SEND_FAILED');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      id="main"
      className="app-main flex flex-col gap-4"
      style={{ maxWidth: 460, paddingTop: 48 }}
    >
      <div className="app-top">
        <span className="brand" aria-hidden="true">
          {t('brand')}
        </span>
        <LanguagePicker />
      </div>
      <h1 className="hero-big" style={{ color: 'var(--ink)', textAlign: 'left', fontSize: 40 }}>
        {t('brand')}
      </h1>
      <Button disabled={busy} onClick={() => run(openLiveDemo)}>
        {t('auth.demo')}
      </Button>
      <Card title={t('auth.title')}>
        {email === null ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={emailRhf.handleSubmit((v) =>
              run(async () => {
                await sendOtp(v.email);
                setEmail(v.email.trim().toLowerCase());
              }),
            )}
            noValidate
          >
            <Input
              label={t('auth.email')}
              type="email"
              autoComplete="email"
              inputMode="email"
              {...emailRhf.register('email')}
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              {t('auth.sendCode')}
            </Button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={codeRhf.handleSubmit((v) => run(() => verifyOtp(email, v.code)))}
            noValidate
          >
            <p>{t('auth.codeSent', { email })}</p>
            <Input
              label={t('auth.code')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              {...codeRhf.register('code')}
            />
            <Button type="submit" disabled={busy}>
              {t('auth.verify')}
            </Button>
            <Button variant="secondary" onClick={() => setEmail(null)}>
              {t('auth.useOtherEmail')}
            </Button>
          </form>
        )}
        {errorCode ? (
          <p className="ui-error" role="alert">
            {t(`auth.errors.${errorCode}`)}
          </p>
        ) : null}
      </Card>
      <p className="text-center">
        <Link to="/how-it-works">{t('How it works')}</Link> {t('·')}{' '}
        <Link to="/trust">{t('pages.trust')}</Link> {t('·')}{' '}
        <Link to="/privacy">{t('Privacy notice')}</Link>
      </p>
    </main>
  );
}
