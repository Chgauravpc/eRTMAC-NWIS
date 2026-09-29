import { supabase } from './supabase';

export class NwisApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = 'NwisApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  
  if (!res.ok) {
    let errBody;
    try {
      errBody = await res.json();
    } catch {
      throw new NwisApiError('NWIS_UNKNOWN', 'Unknown server error', res.status);
    }
    const { code = 'NWIS_INTERNAL', message = 'Internal Error', details = {} } = errBody.error || {};
    throw new NwisApiError(code, message, res.status, details);
  }

  if (res.status === 204) return null;
  return res.json();
}
