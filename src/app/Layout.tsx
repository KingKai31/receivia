import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

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

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `nav-link flex items-center ${isActive ? 'nav-link-active' : ''}`;

export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen md:flex">
      <aside className="app-sidebar hidden md:flex md:w-56 md:flex-col md:gap-2 md:p-4">
        <strong className="mb-2 block">{t('brand')}</strong>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
          {NAV_ITEMS.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
              {t(`nav.${i.key}`)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 pb-24 md:pb-6">
        <Outlet />
      </main>
      <nav
        aria-label={t('nav.main')}
        className="app-bottom-nav fixed inset-x-0 bottom-0 flex md:hidden"
      >
        {NAV_ITEMS.map((i) => (
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
      </nav>
    </div>
  );
}
