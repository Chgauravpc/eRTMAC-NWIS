// FE-11 / contract amendment: a document no well matched gets a well_header/well_id review field.
// The reviewer picks the well (Approve stays off until then), and the document is reprocessed afterwards.
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
import { needsWellChoice, isWellAssignment } from './value';
import wellsFixture from '../../mocks/fixtures/wells.json';

vi.mock('../auth/useProfile', () => ({ useProfile: () => ({ profile: { role: 'reviewer' } }) }));

const DOC = '10000000-0000-4000-a000-0000000000f1';
const JOB = '20000000-0000-4000-a000-0000000000f1';
const FIELD = '30000000-0000-4000-a000-0000000000f1';
const WELL = wellsFixture[0];

const server = setupServer(...handlers);
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.stubEnv('VITE_USE_MOCKS', 'true');
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
  const now = new Date().toISOString();
  db.insert('documents', {
    id: DOC, well_id: null, wellbore_id: null, doc_type: 'ddr', title: 'DDR no well.pdf', file_path: 'x/y.pdf',
    sha256: 'a'.repeat(64), pages: 1, has_text_layer: true, ocr_engine: 'rapidocr', provenance: 'direct', uploaded_by: null, created_at: now,
  });
  db.insert('jobs', { id: JOB, doc_id: DOC, status: 'needs_review', stage: 'index', progress: 100, error: null, created_by: null, created_at: now, updated_at: now });
  db.insert('extracted_fields', {
    id: FIELD, job_id: JOB, doc_id: DOC, entity: 'well_header', entity_id: null, field: 'well_id', page: 1,
    value: { raw: 'SYN-UNKNOWN-9', value: null, unit: null }, confidence: 0, reason: 'unmatched_well', review_status: 'pending',
  });
});
afterEach(() => server.resetHandlers());

const renderDoc = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/review/${DOC}`]}>
        <Routes>
          <Route path="/review/:docId" element={<ReviewDoc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('well assignment helpers', () => {
  it('recognises the field and whether a well was chosen', () => {
    const f = { entity: 'well_header', field: 'well_id', value: { raw: 'X', value: null } };
    expect(isWellAssignment(f)).toBe(true);
    expect(needsWellChoice(f)).toBe(true);
    expect(needsWellChoice({ ...f, value: { raw: 'X', value: WELL.well_id } })).toBe(false);
    expect(isWellAssignment({ entity: 'well_header', field: 'kb_elev_m' })).toBe(false);
    expect(needsWellChoice({ entity: 'event', field: 'md_from_m', value: null })).toBe(false);
  });
});

describe('FE-11 unmatched well', () => {
  it('shows the reason, keeps Approve off until a well is chosen, then assigns it and starts reprocessing', async () => {
    const user = userEvent.setup();
    renderDoc();

    const card = await screen.findByRole('listitem', { name: /well_id/i });
    expect(within(card).getByText("Couldn't match this report to a known well")).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Approve Well header well_id/ })).toBeDisabled();
    expect(within(card).getByText(/Choose the well with Edit/)).toBeInTheDocument();

    // the keyboard shortcut cannot approve it either
    await user.keyboard('a');
    expect(await screen.findByText('Choose the well first (Edit), then approve.')).toBeInTheDocument();
    expect(db.get('extracted_fields', FIELD).review_status).toBe('pending');

    await user.keyboard('e');
    const select = await screen.findByLabelText('Well for this document');
    await waitFor(() => expect(within(select).getByRole('option', { name: WELL.well_name })).toBeInTheDocument());
    await user.selectOptions(select, WELL.well_id);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(db.get('extracted_fields', FIELD).review_status).toBe('edited'));
    expect(db.get('documents', DOC)).toMatchObject({ well_id: WELL.well_id, wellbore_id: WELL.wellbore_id });

    // reprocessing started: a new job for this document, and a link to follow it
    const status = await screen.findByTestId('reprocess-status');
    expect(status).toHaveTextContent('Well assigned');
    expect(within(status).getByRole('link', { name: /Follow progress on Documents/ })).toHaveAttribute('href', '/documents');
    expect(db.select('jobs', (j) => j.doc_id === DOC).length).toBe(2);
  });
});
