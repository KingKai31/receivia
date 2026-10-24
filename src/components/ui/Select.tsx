import { tr } from '@/app/i18n';
import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, id, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className="ui-field">
      <label htmlFor={selectId}>{t(label)}</label>
      <select
        ref={ref}
        id={selectId}
        className="ui-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {tr(o.label)}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${selectId}-error`} className="ui-error" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
});
