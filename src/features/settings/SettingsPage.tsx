import { useTranslation } from 'react-i18next';
import { Badge, Button, Card } from '@/components/ui';
import { signOut } from '@/features/auth/authApi';
import { useOrg } from '@/features/auth/useOrg';
import { ForecastSettings } from '@/features/forecast/ForecastSettings';
import { AgentSettings } from '@/features/agent/AgentSettings';
import { LadderSettings } from '@/features/collect/LadderSettings';
import { BusinessProfileForm } from './BusinessProfileForm';

export function SettingsPage() {
  const { t } = useTranslation();
  const org = useOrg();
  return (
    <>
      <h1>{t('pages.settings')}</h1>
      <Card>
        {org.isLoading ? (
          <p>{t('common.loading')}</p>
        ) : org.data ? (
          <p>
            {t('{{orgName}} ·', { orgName: org.data.orgName })} {t('common.role')}
            {t(':')} <Badge>{org.data.role}</Badge>
          </p>
        ) : (
          <p>{t('common.noOrg')}</p>
        )}
        <Button variant="secondary" onClick={() => void signOut()}>
          {t('auth.signOut')}
        </Button>
      </Card>
      <BusinessProfileForm />
      <ForecastSettings />
      <LadderSettings />
      <AgentSettings />
    </>
  );
}
