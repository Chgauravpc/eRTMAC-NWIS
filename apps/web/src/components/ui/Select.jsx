import React, { useId } from 'react';
import { cn, FOCUS_RING } from './cn';

/**
 * Labelled native select.
 *   <Select label="Formation" value={v} onChange={(value) => ...}
 *           options={['Tipam', { value: 'b', label: 'Barail' }]} placeholder="All formations" />
 * options: strings or { value, label, disabled }. onChange receives the string value.
 * `placeholder` adds a leading empty option (value ''). Pass `hideLabel` to keep the label screen-reader only.
 */
export function Select({ label, value, onChange, options, placeholder, hideLabel, className, disabled, ...rest }) {
  const id = useId();
  const items = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={id} className={cn('text-sm font-medium text-gray-700', hideLabel && 'sr-only')}>
          {label}
        </label>
      )}
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn('rounded border border-gray-300 bg-white px-2 py-1.5 text-sm', FOCUS_RING)}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {items.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
