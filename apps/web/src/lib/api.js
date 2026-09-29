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

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

const withBase = (path) => {
  if (path.startsWith('http') || path.startsWith(`${API_BASE}/`)) return path; // already absolute / already prefixed
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
};

/**
 * Thin REST helper over apiFetch for the Node routes (contract §9.2).
 * Paths are relative to VITE_API_BASE (default `/api`), e.g. api.get('/wells/123/correlation', { params }).
 */
export const api = {
  get(path, { params, ...options } = {}) {
    const qs = params
      ? '?' +
        new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
        ).toString()
      : '';
    return apiFetch(withBase(path) + (qs === '?' ? '' : qs), { ...options, method: 'GET' });
  },
  post(path, body, options = {}) {
    return apiFetch(withBase(path), { ...options, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  patch(path, body, options = {}) {
    return apiFetch(withBase(path), { ...options, method: 'PATCH', body: JSON.stringify(body) });
  },
};
