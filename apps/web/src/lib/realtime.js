import { supabase } from './supabase';
import { db } from '../mocks/db';

const isMock = import.meta.env.VITE_USE_MOCKS === 'true';

export function subscribe(table, filter, onChange) {
  if (isMock) {
    const handler = (e) => {
      // Very basic filtering implementation for mocks (e.g. "wellbore_id=eq.1234")
      if (filter && filter.includes('=eq.')) {
        const [field, valStr] = filter.split('=eq.');
        if (e.detail[field] !== valStr) return;
      }
      onChange({ new: e.detail });
    };
    db.emitter.addEventListener(`change:${table}`, handler);
    return () => db.emitter.removeEventListener(`change:${table}`, handler);
  }

  // Real Supabase channel
  const channel = supabase.channel(`public:${table}${filter ? ':' + filter : ''}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, payload => {
      onChange(payload);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
