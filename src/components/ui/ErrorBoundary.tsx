import { Component, type ErrorInfo, type ReactNode } from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';
import { logError } from '@/lib/errorLog';
import { Button } from './Button';

interface Props extends WithTranslation {
  children: ReactNode;
}

class Boundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logError(Object.assign(error, { stack: error.stack ?? info.componentStack ?? '' }));
  }

  render() {
    const { t } = this.props;
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="ui-empty">
        <h2>{t('This screen hit a problem')}</h2>
        <p>
          {t(
            'The rest of the app still works. Try again; if it keeps happening, reload the page. The problem has been recorded so it can be fixed.',
          )}
        </p>
        <p className="ui-hint">{this.state.error.message}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => this.setState({ error: null })}>{t('Try again')}</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            {t('Go to Today')}
          </Button>
        </div>
      </div>
    );
  }
}

/** One per route: a crash in a screen leaves the rest of the app usable. */
export const ErrorBoundary = withTranslation()(Boundary);
