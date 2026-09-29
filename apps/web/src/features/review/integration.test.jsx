// End-to-end through the REAL data layer: components -> hooks -> supabase-js/fetch -> MSW handlers -> mock db + realtime bus.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { handlers } from '../../mocks/handlers';
import { mockConfig, resetDocumentsMock } from '../../mocks/handlers/documents';
import { db } from '../../mocks/db';
import { ReviewDoc } from './ReviewDoc';
import { ReviewQueue } from './ReviewQueue';
import { DocumentList } from '../documents/DocumentList';
import { DocumentsPage } from '../documents/DocumentsPage';
import { reviewField } from '../../lib/data/review';
import { getJobSummary } from '../../lib/data/documents';

vi.mock('../auth/useProfile', () => ({ useProfile: () => ({ profile: { role: 'reviewer' } }) }));

const D2 = '10000000-0000-4000-a000-000000000002';
const J2 = '20000000-0000-4000-a000-000000000002';
const server = setupServer(...handlers);
const realFetch = globalThis.fetch;

beforeAll(() => {
  // updates arrive from the mock bus / timers outside act(); the assertions use waitFor/findBy
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  // Node's fetch needs absolute URLs; the app uses same-origin '/api/...' paths.
  globalThis.fetch = (input, init) =>
    realFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin).toString() : input, init);
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});
beforeEach(() => {
  resetDocumentsMock();
  mockConfig.stepMs = 5;
  localStorage.removeItem('nwis_mock_role');
});
afterEach(() => server.resetHandlers());

const Providers = ({ children, path = '/' }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe('FE-11 acceptance: approving the last field shows the job as done in FE-10', () => {
  it('keyboard-approves every field of a document and the document list flips to Done live', async () => {
    const user = userEvent.setup();
    render(
      <>
        <DocumentList />
        <Routes>
          <Route path="/review/:docId" element={<ReviewDoc />} />
        </Routes>
      </>,
      { wrapper: ({ children }) => <Providers path={`/review/${D2}`}>{children}</Providers> }
    );

    // FE-10 list (real query): the DDR is waiting for review, the WCR is done
    const row = (await screen.findByText('DDR 2019-03-12 SYN-DLJ-03.pdf')).closest('tr');
    expect(within(row).getByTestId('doc-status')).toHaveTextContent('Needs review');
    expect(within(row).getByText('SYN-DLJ-03')).toBeInTheDocument(); // wells.name join

    // first field is focused with its bbox highlighted; page image comes from the page-images bucket
    const first = await screen.findByRole('listitem', { name: /event_type/i });
    await waitFor(() => expect(first).toHaveFocus());
    const img = await screen.findByAltText('Document page');
    expect(img.getAttribute('src')).toMatch(/\/storage\/v1\/object\/sign\/page-images\/10000000-0000-4000-a000-000000000002\/1\.png/);

    // review all 8 pending fields with the keyboard: edit one, reject one, approve the rest
    await user.keyboard('a'); // event_type
    await waitFor(() => expect(db.get('extracted_fields', '30000000-0000-4000-a000-000000000001').review_status).toBe('approved'));
    await user.keyboard('a'); // md_from_m
    await waitFor(() => expect(db.get('extracted_fields', '30000000-0000-4000-a000-000000000002').review_status).toBe('approved'));
    await user.keyboard('r'); // md_to_m (depth deeper than TD)
    await waitFor(() => expect(db.get('extracted_fields', '30000000-0000-4000-a000-000000000003').review_status).toBe('rejected'));
    await user.keyboard('e'); // formation -> select from the formations table
    const formation = await screen.findByLabelText(/New value for formation/);
    await waitFor(() => expect(within(formation).getByRole('option', { name: 'Tipam' })).toBeInTheDocument());
    await user.selectOptions(formation, 'Tipam');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(db.get('extracted_fields', '30000000-0000-4000-a000-000000000004').review_status).toBe('edited'));
    await user.keyboard('a'); // volume_m3
    await user.keyboard('a'); // description (no bbox: snippet_not_found)
    await waitFor(() => expect(db.get('extracted_fields', '30000000-0000-4000-a000-000000000006').review_status).toBe('approved'));

    // event cascade (contract §7): the event was rejected via md_to_m
    expect(db.get('doc_events', '40000000-0000-4000-a000-000000000001').review_status).toBe('rejected');

    // two fields on page 2 remain; the job is still waiting for review
    expect(db.get('jobs', J2).status).toBe('needs_review');
    await screen.findByText(/Page 2 of 2/);
    await user.keyboard('a');
    expect(db.get('jobs', J2).status).toBe('needs_review');
    await waitFor(() => expect(db.get('extracted_fields', '30000000-0000-4000-a000-000000000007').review_status).toBe('approved'));
    await user.keyboard('a'); // LAST pending field

    await waitFor(() => expect(db.get('jobs', J2)).toMatchObject({ status: 'done', stage: 'done', progress: 100 }));
    expect(await screen.findByText('Document reviewed')).toBeInTheDocument();
    // FE-10 list updates through the realtime bus, no reload
    await waitFor(() => expect(within(row).getByTestId('doc-status')).toHaveTextContent('Done'));
    // and the queue no longer lists the document
    expect(db.select('extracted_fields', (f) => f.doc_id === D2 && f.review_status === 'pending')).toHaveLength(0);
  }, 30000);
});

describe('review_field through HTTP (contract §7 + migration 0009 errors)', () => {
  it('approve / edit / reject set the field status and return the row', async () => {
    const a = await reviewField('30000000-0000-4000-a000-000000000009', 'approve');
    expect(a.review_status).toBe('approved');
    const e = await reviewField('30000000-0000-4000-a000-000000000010', 'edit', { raw: '2.9 SG', value: 1.9, unit: 'SG' });
    expect(e).toMatchObject({ review_status: 'edited', value: { value: 1.9 } });
  });

  it('NWIS_BAD_REQUEST for an invalid action, edit without value, protected columns and missing target rows', async () => {
    await expect(reviewField('30000000-0000-4000-a000-000000000009', 'explode')).rejects.toMatchObject({ code: 'NWIS_BAD_REQUEST', message: expect.stringContaining('invalid review action') });
    await expect(reviewField('30000000-0000-4000-a000-000000000009', 'edit', null)).rejects.toMatchObject({ code: 'NWIS_BAD_REQUEST', message: expect.stringContaining('value is required') });

    db.insert('extracted_fields', { id: 'aaaaaaaa-0000-4000-a000-000000000001', job_id: J2, doc_id: D2, page: 1, entity: 'event', entity_id: 'e', field: 'wellbore_id', value: 'x', confidence: 0.4, review_status: 'pending' });
    await expect(reviewField('aaaaaaaa-0000-4000-a000-000000000001', 'approve')).rejects.toMatchObject({ code: 'NWIS_BAD_REQUEST', message: expect.stringContaining('column wellbore_id is protected') });

    db.insert('extracted_fields', { id: 'aaaaaaaa-0000-4000-a000-000000000002', job_id: J2, doc_id: D2, page: 1, entity: 'event', entity_id: null, field: 'description', value: 'x', confidence: 0.4, review_status: 'pending' });
    await expect(reviewField('aaaaaaaa-0000-4000-a000-000000000002', 'approve')).rejects.toMatchObject({ code: 'NWIS_BAD_REQUEST', message: expect.stringContaining('no target row') });
  });

  it('NWIS_NOT_FOUND for unknown fields and NWIS_FORBIDDEN for office engineers', async () => {
    await expect(reviewField('00000000-0000-4000-a000-00000000dead', 'approve')).rejects.toMatchObject({ code: 'NWIS_NOT_FOUND' });
    localStorage.setItem('nwis_mock_role', 'office_engineer');
    const err = await reviewField('30000000-0000-4000-a000-000000000009', 'approve').catch((e) => e);
    expect(err.code).toBe('NWIS_FORBIDDEN');
    expect(err.message).toMatch(/permission/i);
  });

  it('counts events and pending fields for the job summary (HEAD + Content-Range)', async () => {
    expect(await getJobSummary('10000000-0000-4000-a000-000000000001')).toEqual({ events: 4, pending: 0 });
    expect(await getJobSummary(D2)).toEqual({ events: 1, pending: 8 });
  });
});

describe('ReviewQueue against the mock backend', () => {
  it('groups pending fields by doc_id with well name and counts', async () => {
    render(<ReviewQueue />, { wrapper: Providers });
    expect(await screen.findByText('DDR 2019-03-12 SYN-DLJ-03.pdf')).toBeInTheDocument();
    const row = screen.getByText('DDR 2019-03-12 SYN-DLJ-03.pdf').closest('tr');
    expect(within(row).getByText('8')).toBeInTheDocument();
    expect(within(row).getByText('SYN-DLJ-03')).toBeInTheDocument();
    const mud = screen.getByText('Mud log SYN-DLJ-01.pdf').closest('tr');
    expect(within(mud).getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('WCR SYN-DLJ-03.pdf')).toBeNull(); // nothing pending there
    // oldest first
    const titles = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(titles[0]).toContain('DDR 2019-03-12');
  });
});

describe('FE-10 full upload through the mock backend', () => {
  it('uploads via signed URL (XHR), registers, shows live stages, needs_review, then done after review', async () => {
    const user = userEvent.setup();
    mockConfig.stepMs = 15;
    render(<DocumentsPage />, { wrapper: Providers });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, new File(['%PDF-1.4 mock'], 'New DDR 2019-04-01.pdf', { type: 'application/pdf' }));

    // job appears in the library list and reaches needs_review
    expect(await screen.findByText(/3 fields need review/, {}, { timeout: 8000 })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Review now/i });
    const docId = link.getAttribute('href').replace('/review/', '');
    expect(db.get('documents', docId)).toMatchObject({ title: 'New DDR 2019-04-01.pdf', doc_type: 'ddr', provenance: 'direct' });

    // approve the three generated fields (data layer), like the review screen does
    const fields = db.select('extracted_fields', (f) => f.doc_id === docId);
    expect(fields).toHaveLength(3);
    for (const f of fields) await reviewField(f.id, 'approve');
    await waitFor(() => expect(screen.getByText(/Ready: 1 events extracted/)).toBeInTheDocument(), { timeout: 4000 });
  }, 30000);

  it('uploading the same file again reports "Already in the library"', async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />, { wrapper: Providers });
    await user.upload(document.querySelector('input[type="file"]'), new File(['x'], 'WCR SYN-DLJ-03.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/Already in the library/i, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View existing/i })).toHaveAttribute('href', '/search?doc=10000000-0000-4000-a000-000000000001');
  }, 30000);
});
