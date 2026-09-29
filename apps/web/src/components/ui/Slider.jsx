import React, { useId } from 'react';
import { cn, FOCUS_RING } from './cn';

/**
 * Labelled range slider.
 *   <Slider label="Radius" value={10} min={1} max={25} step={1} onChange={(n) => ...}
 *           format={(n) => `${n} km`} />
 * onChange receives a number. `format` renders the visible value (also used for aria-valuetext).
 */
export function Slider({ label, value, min = 0, max = 100, step = 1, onChange, format = String, className, disabled }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium text-gray-700">
          {label}
        </label>
        <output htmlFor={id} className="tabular-nums text-gray-600">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={String(format(value))}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className={cn('w-full accent-blue-600', FOCUS_RING)}
      />
    </div>
  );
}
