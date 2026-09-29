import React, { useId, useRef, useState } from 'react';
import { cn, FOCUS_RING } from './cn';

/**
 * Accessible tabs (WAI-ARIA tabs pattern, arrow keys / Home / End).
 *   <Tabs tabs={[{ id, label, content }]} defaultId="a" value="a" onChange={fn} />
 * Uncontrolled unless `value` is given. Only the active panel is rendered.
 */
export function Tabs({ tabs, value, defaultId, onChange, className, label = 'Sections' }) {
  const uid = useId();
  const [inner, setInner] = useState(defaultId ?? tabs[0]?.id);
  const active = value ?? inner;
  const refs = useRef({});

  const select = (id) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (e) => {
    const idx = tabs.findIndex((t) => t.id === active);
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = tabs[next].id;
    select(id);
    refs.current[id]?.focus();
  };

  const current = tabs.find((t) => t.id === active);
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-gray-200 overflow-x-auto" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            id={`${uid}-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`${uid}-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            onClick={() => select(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px',
              FOCUS_RING,
              t.id === active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current && (
        <div
          role="tabpanel"
          id={`${uid}-panel-${current.id}`}
          aria-labelledby={`${uid}-tab-${current.id}`}
          tabIndex={0}
          className={cn('pt-4', FOCUS_RING)}
        >
          {current.content}
        </div>
      )}
    </div>
  );
}
