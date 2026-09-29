import { http, HttpResponse } from 'msw';
import { db } from '../db';
import searchData from '../fixtures/search_results.json';
import askData from '../fixtures/ask_answers.json';
import correlationData from '../fixtures/correlation.json';
import planningData from '../fixtures/planning_brief.json';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';

export const handlers = [
  // --- VERCEL NODE ROUTES (/api/*) ---

  http.post('/api/documents/upload-url', async () => {
    return HttpResponse.json({
      upload_id: 'mock-upload-uuid',
      storage_path: 'incoming/mock-upload-uuid/mock.pdf',
      signed_url: 'https://mock.url',
      token: 'mock-token'
    });
  }),

  http.post('/api/documents', async () => {
    return HttpResponse.json({ document_id: 'mock-doc', job_id: 'mock-job', duplicate: false }, { status: 202 });
  }),

  http.post('/api/search', async () => {
    return HttpResponse.json(searchData);
  }),

  http.post('/api/ask', async () => {
    return HttpResponse.json(askData);
  }),

  http.get('/api/wells/:id/correlation', async () => {
    return HttpResponse.json(correlationData);
  }),

  http.post('/api/wells/:id/predict-tops', async () => {
    return HttpResponse.json({
      tops: [{ formation: 'Tipam', top_md_m: 2310.5, top_tvdss_m: 2261.0, uncertainty_m: 28.4, n_offsets: 5 }]
    });
  }),

  http.post('/api/planning/brief', async () => {
    return HttpResponse.json(planningData);
  }),

  http.post('/api/stream/drop', async ({ request }) => {
    const { seconds } = await request.json();
    return HttpResponse.json({ dropping_until: new Date(Date.now() + seconds * 1000).toISOString() });
  }),

  // --- SUPABASE REST CALLS ---

  http.get(`${SUPABASE_URL}/rest/v1/v_well_summary`, () => {
    return HttpResponse.json(db.wells);
  }),

  http.get(`${SUPABASE_URL}/rest/v1/alerts`, () => {
    return HttpResponse.json(db.alerts);
  }),

  // --- SUPABASE RPC CALLS ---

  http.post(`${SUPABASE_URL}/rest/v1/rpc/ack_alert`, async ({ request }) => {
    const { p_alert, p_note } = await request.json();
    const alert = db.getAlert(p_alert);
    if (!alert) return HttpResponse.json({ error: { message: "NWIS_NOT_FOUND" } }, { status: 404 });
    if (alert.state !== 'generated' && alert.state !== 'sent' && alert.state !== 'viewed' && alert.state !== 'escalated') {
      return HttpResponse.json({ error: { message: "NWIS_BAD_STATE: Alert cannot be acknowledged now" } }, { status: 409 });
    }
    const updated = db.updateAlert(p_alert, { 
      state: 'acknowledged', 
      acknowledged_at: new Date().toISOString(),
      action_note: p_note 
    });
    return HttpResponse.json(updated);
  }),

  http.post(`${SUPABASE_URL}/rest/v1/rpc/resolve_alert`, async ({ request }) => {
    const { p_alert, p_outcome, p_note } = await request.json();
    const updated = db.updateAlert(p_alert, { 
      state: 'resolved',
      resolved_how: 'manual',
      outcome: p_outcome,
      resolved_at: new Date().toISOString(),
      action_note: p_note
    });
    return HttpResponse.json(updated);
  }),

  http.post(`${SUPABASE_URL}/rest/v1/rpc/dismiss_alert`, async ({ request }) => {
    const { p_alert, p_reason } = await request.json();
    if (!p_reason || p_reason.length < 5) {
      return HttpResponse.json({ error: { message: "NWIS_BAD_REQUEST: Reason must be >= 5 chars" } }, { status: 400 });
    }
    const updated = db.updateAlert(p_alert, { 
      state: 'resolved',
      resolved_how: 'dismissed',
      outcome: 'false_alarm',
      dismiss_reason: p_reason,
      resolved_at: new Date().toISOString()
    });
    return HttpResponse.json(updated);
  }),
];
