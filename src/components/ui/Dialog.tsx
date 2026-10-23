import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Native <dialog>: focus trap, Escape to close and inert background come from the browser. */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} className="ui-dialog" aria-label={title} onClose={onClose}>
      <h2 className="mt-0">{title}</h2>
      {children}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </dialog>
  );
}
