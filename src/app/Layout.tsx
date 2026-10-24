import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LanguagePicker } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { setErrorContext } from '@/lib/errorLog';

export const NAV_ITEMS = [
  { to: '/', key: 'today', end: true },
  { to: '/invoices', key: 'invoices', end: false },
  { to: '/customers', key: 'customers', end: false },
  { to: '/collect', key: 'collect', end: false },
  { to: '/inbox', key: 'inbox', end: false },
  { to: '/payments', key: 'payments', end: true },
  { to: '/forecast', key: 'forecast', end: false },
  { to: '/expenses', key: 'expenses', end: false },
  { to: '/settings', key: 'settings', end: false },
] as const;

/** Phone tab bar: the four daily screens, everything else under More. */
const TAB_KEYS = ['today', 'collect', 'invoices', 'forecast'] as const;
const TABS = TAB_KEYS.map((k) => NAV_ITEMS.find((i) => i.key === k)!);
const MORE = NAV_ITEMS.filter((i) => !(TAB_KEYS as readonly string[]).includes(i.key));

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `nav-link flex items-center ${isActive ? 'nav-link-active' : ''}`;

export function Layout() {
  const { t } = useTranslation();
  const org = useOrg();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const orgId = org.data?.orgId ?? null;
  useEffect(() => setErrorContext(orgId), [orgId]);
  useEffect(() => setMore(false), [pathname]);
  const moreActive = MORE.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  return (
    <div className="app-shell md:flex">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="skip-link sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:p-3"
      >
        {t('Skip to content')}
      </a>
      <aside className="app-sidebar glass hidden md:flex md:flex-col md:gap-2">
        <strong className="brand mb-2 block px-3">{t('brand')}</strong>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
          {NAV_ITEMS.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
              {t(`nav.${i.key}`)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main id="main" tabIndex={-1} className="app-main">
        <div className="app-top">
          <span className="brand md:invisible">{t('brand')}</span>
          <LanguagePicker />
        </div>
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
      {more ? (
        <div className="more-sheet glass glass-solid" id="more-sheet">
          {MORE.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
              {t(`nav.${i.key}`)}
            </NavLink>
          ))}
        </div>
      ) : null}
      <nav aria-label={t('nav.main')} className="app-bottom-nav glass fixed flex md:hidden">
        {TABS.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) =>
              `nav-link flex flex-1 items-center justify-center text-center ${isActive ? 'nav-link-active' : ''}`
            }
          >
            {t(`nav.${i.key}`)}
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={more}
          aria-controls="more-sheet"
          onClick={() => setMore((v) => !v)}
          className={`nav-link flex flex-1 items-center justify-center text-center ${moreActive || more ? 'nav-link-active' : ''}`}
        >
          {t('nav.more')}
        </button>
      </nav>
    </div>
  );
}
