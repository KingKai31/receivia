import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'receivia.theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(read);
  const opts: Theme[] = ['system', 'light', 'dark'];
  return (
    <div role="group" aria-label={t('Theme')} className="chip-group glass">
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          className="chip-btn"
          aria-pressed={theme === o}
          onClick={() => {
            setTheme(o);
            applyTheme(o);
          }}
        >
          {t(`theme.${o}`)}
        </button>
      ))}
    </div>
  );
}
