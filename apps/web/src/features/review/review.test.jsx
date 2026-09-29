import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageViewer } from './PageViewer';
import { FieldCard } from './FieldList';
import { FieldEditor, buildEditPayload, editorKind, parseDraft } from './FieldEditor';
import { ReviewDoc } from './ReviewDoc';
import { ReviewQueue } from './ReviewQueue';
import { bboxToPercentStyle, bboxToPixels, isValidBbox } from './bbox';
import { REASON_TEXT, reasonTexts } from './reasons';
import { formatFieldValue, parseFieldValue } from './value';
import { renderPageSvg, PAGE_W, PAGE_H } from '../../mocks/handlers/documents';
import pagesFixture from '../../mocks/fixtures/document_pages.json';
import fieldsFixture from '../../mocks/fixtures/review_fields.json';
import * as review from '../../lib/data/review';
import { EVENT_TYPES } from '../../lib/constants';

vi.mock('../../lib/data/review', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    getReviewQueue: vi.fn(),
    getFieldsForDocument: vi.fn(),
    getDocumentPages: vi.fn(),
    getFormations: vi.fn(),
    getPageImageUrl: vi.fn(),
    reviewField: vi.fn(),
  };
});
vi.mock('../auth/useProfile', () => ({ useProfile: vi.fn() }));
import { useProfile } from '../auth/useProfile';

const Wrapper = ({ children, path = '/review/doc-1' }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  </QueryClientProvider>
);

/* ------------------------------------------------------------------ pure helpers */

describe('bbox maths', () => {
  it('turns fractions into CSS percentages', () => {
    expect(bboxToPercentStyle({ x: 0.12, y: 0.4, w: 0.3, h: 0.03 })).toEqual({ left: '12%', top: '40%', width: '30%', height: '3%' });
  });

  it('turns fractions x image size into pixels', () => {
    expect(bboxToPixels({ x: 0.12, y: 0.4, w: 0.3, h: 0.03 }, 850, 1100)).toEqual({
      left: 0.12 * 850,
      top: 0.4 * 1100,
      width: 0.3 * 850,
      height: 0.03 * 1100,
    });
    // scaling the image scales the box, the percentage style does not change
    const a = bboxToPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, 400, 500);
    const b = bboxToPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, 800, 1000);
    expect(b.left).toBe(a.left * 2);
    expect(b.height).toBe(a.height * 2);
  });

  it('clamps to the page and rejects malformed boxes', () => {
    expect(bboxToPercentStyle({ x: 0.9, y: 0.95, w: 0.5, h: 0.5 })).toEqual({ left: '90%', top: '95%', width: '10%', height: '5%' });
    expect(bboxToPercentStyle({ x: -1, y: 0, w: 0.2, h: 0.2 }).left).toBe('0%');
    for (const bad of [null, undefined, {}, { x: 'a', y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0, h: 0.1 }]) {
      expect(isValidBbox(bad)).toBe(false);
      expect(bboxToPercentStyle(bad)).toBeNull();
    }
  });

  it('PageViewer overlay uses exactly the bbox percentages inside a frame the size of the image', () => {
    const field = { bbox: { x: 0.12, y: 0.4, w: 0.3, h: 0.03 } };
    render(<PageViewer imageUrl="test.png" selectedField={field} />);
    const overlay = screen.getByTestId('bbox-overlay');
    expect(overlay).toHaveStyle({ left: '12%', top: '40%', width: '30%', height: '3%' });
    // the overlay is a direct child of the frame that wraps only the image, so % are of the image box
    const frame = screen.getByTestId('page-frame');
    expect(overlay.parentElement).toBe(frame);
    expect(frame.querySelector('img')).toHaveClass('block');
  });

  it('shows no overlay (and says why) when the field has no bbox', () => {
    render(<PageViewer imageUrl="test.png" selectedField={{ bbox: null }} />);
    expect(screen.queryByTestId('bbox-overlay')).toBeNull();
    expect(screen.getByText(/No location recorded/)).toBeInTheDocument();
  });

  it('fixture: every bbox coincides with the drawn text line it points at', () => {
    const withBox = fieldsFixture.filter((f) => f.bbox);
    expect(withBox.length).toBeGreaterThan(5);
    for (const f of withBox) {
      const page = pagesFixture.find((p) => p.doc_id === f.doc_id && p.page_no === f.page);
      const line = page.lines.find((l) => l.x === f.bbox.x && l.y === f.bbox.y && l.w === f.bbox.w && l.h === f.bbox.h);
      expect(line, `no text line at the bbox of ${f.field}`).toBeTruthy();
      const { raw, value } = parseFieldValue(f.value);
      const needle = String(raw ?? value ?? '');
      if (needle) expect(line.text).toContain(needle);
      // and the rendered image box in pixels stays inside the page
      const px = bboxToPixels(f.bbox, PAGE_W, PAGE_H);
      expect(px.left + px.width).toBeLessThanOrEqual(PAGE_W);
      expect(px.top + px.height).toBeLessThanOrEqual(PAGE_H);
    }
  });

  it('fixture: the generated page image draws each line in its own box (x, baseline, width)', () => {
    const page = pagesFixture.find((p) => p.doc_id === fieldsFixture[0].doc_id && p.page_no === 1);
    const svg = renderPageSvg(page.lines);
    for (const l of page.lines) {
      expect(svg).toContain(`x="${+(l.x * PAGE_W).toFixed(2)}"`);
      expect(svg).toContain(`textLength="${+(l.w * PAGE_W).toFixed(2)}"`);
      const baseline = (l.y + l.h * 0.8) * PAGE_H;
      expect(baseline).toBeGreaterThan(l.y * PAGE_H);
      expect(baseline).toBeLessThan((l.y + l.h) * PAGE_H);
    }
  });
});

describe('reason codes', () => {
  it('maps every reason code of the contract/PRD to plain language', () => {
    expect(reasonTexts('low_ocr_confidence')).toEqual(['Scan was hard to read']);
    expect(reasonTexts('failed_rule:depth_gt_td')).toEqual(["Depth is deeper than the well's TD"]);
    expect(reasonTexts('unknown_formation')).toEqual(['Formation name not recognised']);
    expect(reasonTexts('snippet_not_found')).toEqual(["Couldn't find this text on the page"]);
    for (const rule of ['depth_gt_td', 'depth_negative', 'formation_order', 'date_out_of_range', 'mw_out_of_range']) {
      expect(REASON_TEXT[`failed_rule:${rule}`], rule).toBeTruthy();
    }
    expect(REASON_TEXT.unmatched_well).toBeTruthy();
  });

  it('handles several codes, unknown codes and empty', () => {
    expect(reasonTexts('low_ocr_confidence;snippet_not_found')).toHaveLength(2);
    expect(reasonTexts('failed_rule:brand_new_rule')).toEqual(['Failed check: brand new rule']);
    expect(reasonTexts('something_odd')).toEqual(['Something odd']);
    expect(reasonTexts(null)).toEqual([]);
    expect(reasonTexts('')).toEqual([]);
  });
});

describe('value display (jsonb {raw,value,unit}, scalar, null)', () => {
  it('shows raw then SI', () => {
    expect(formatFieldValue({ raw: '15 bbl/hr', value: 2.38, unit: 'm3/h' })).toBe('15 bbl/hr → 2.38 m3/h');
  });
  it('handles scalars, null, missing parts and arrays', () => {
    expect(formatFieldValue(1.25)).toBe('1.25');
    expect(formatFieldValue('Tipam')).toBe('Tipam');
    expect(formatFieldValue(false)).toBe('false');
    expect(formatFieldValue(0)).toBe('0');
    expect(formatFieldValue(null)).toBeNull();
    expect(formatFieldValue(undefined)).toBeNull();
    expect(formatFieldValue({ raw: 'illegible', value: null, unit: null })).toBe('illegible');
    expect(formatFieldValue({ value: 2395, unit: 'm' })).toBe('2395 m');
    expect(formatFieldValue({ raw: '2395', value: 2395 })).toBe('2395');
    expect(formatFieldValue({})).toBeNull();
    expect(formatFieldValue([1, 2])).toBe('[1,2]');
  });
});

describe('FieldCard', () => {
  const base = { id: 'f1', entity: 'event', field: 'volume_m3', confidence: 0.6, review_status: 'pending' };
  const renderCard = (field, props = {}) =>
    render(
      <ul>
        <FieldCard field={{ ...base, ...field }} isSelected={false} onSelect={() => {}} {...props} />
      </ul>,
      { wrapper: Wrapper }
    );

  it('shows raw and SI values, the confidence bar and the plain-language reason', () => {
    renderCard({ value: { raw: '15 bbl/hr', value: 2.38, unit: 'm3/h' }, reason: 'low_ocr_confidence' });
    expect(screen.getByText('15 bbl/hr → 2.38 m3/h')).toBeInTheDocument();
    expect(screen.getByText(/Scan was hard to read/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Confidence' })).toHaveAttribute('aria-valuenow', '60');
  });

  it('copes with null and scalar values', () => {
    renderCard({ value: null, reason: 'unknown_formation', field: 'formation' });
    expect(screen.getByText('No value extracted')).toBeInTheDocument();
    expect(screen.getByText('Formation name not recognised')).toBeInTheDocument();
  });

  it('renders snippet_not_found', () => {
    renderCard({ value: 'x', reason: 'snippet_not_found' });
    expect(screen.getByText(/Couldn't find this text on the page/)).toBeInTheDocument();
  });

  it('shows action buttons only for the selected field, with shortcut metadata and no buttons when read-only', () => {
    const { unmount } = renderCard({ value: 1 }, { isSelected: true, onAction: () => {}, onStartEdit: () => {} });
    expect(screen.getByRole('button', { name: /Approve Event volume_m3/ })).toHaveAttribute('aria-keyshortcuts', 'a');
    expect(screen.getByRole('button', { name: /Edit Event volume_m3/ })).toHaveAttribute('aria-keyshortcuts', 'e');
    expect(screen.getByRole('button', { name: /Reject Event volume_m3/ })).toHaveAttribute('aria-keyshortcuts', 'r');
    unmount();
    renderCard({ value: 1 }, { isSelected: true, isReadOnly: true });
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});

describe('FieldEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    review.getFormations.mockResolvedValue([{ name: 'Alluvium', strat_order: 1 }, { name: 'Tipam', strat_order: 5 }]);
  });

  it('formation is a select filled from the formations table', async () => {
    render(<FieldEditor field={{ id: 'f', field: 'formation', value: null }} onSave={() => {}} onCancel={() => {}} />, { wrapper: Wrapper });
    const select = await screen.findByLabelText(/New value for formation/);
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['', 'Alluvium', 'Tipam']));
  });

  it('event_type is a select of the contract enum', () => {
    render(<FieldEditor field={{ id: 'f', field: 'event_type', value: { raw: 'losses', value: 'loss_partial' } }} onSave={() => {}} onCancel={() => {}} />, { wrapper: Wrapper });
    const select = screen.getByLabelText(/New value for event_type/);
    expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['', ...EVENT_TYPES]);
    expect(select).toHaveValue('loss_partial');
  });

  it('numbers get a number input, dates a date input; empty and NaN are refused', async () => {
    expect(editorKind({ field: 'md_from_m', value: { value: 2395 } })).toBe('number');
    expect(editorKind({ field: 'event_date', value: null })).toBe('date');
    expect(editorKind({ field: 'description', value: 'x' })).toBe('text');
    expect(parseDraft('number', 'abc').ok).toBe(false);
    expect(parseDraft('number', '  ').ok).toBe(false);
    expect(parseDraft('number', '12.5')).toEqual({ ok: true, value: 12.5 });

    const onSave = vi.fn();
    render(<FieldEditor field={{ id: 'f', field: 'md_from_m', value: { raw: '2395 m', value: 2395, unit: 'm' } }} onSave={onSave} onCancel={() => {}} />, { wrapper: Wrapper });
    const input = screen.getByLabelText(/New value for md_from_m/);
    expect(input).toHaveAttribute('type', 'number');
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter a value/);
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.type(input, '2400.5{Enter}');
    expect(onSave).toHaveBeenCalledWith({ raw: '2395 m', value: 2400.5, unit: 'm' });
  });

  it('keeps scalar values scalar and Escape cancels', async () => {
    expect(buildEditPayload({ value: 'a' }, 'b')).toBe('b');
    expect(buildEditPayload({ value: null }, 3)).toBe(3);
    const onCancel = vi.fn();
    render(<FieldEditor field={{ id: 'f', field: 'description', value: 'old' }} onSave={() => {}} onCancel={onCancel} />, { wrapper: Wrapper });
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('mapReviewError', () => {
  it('maps NWIS_FORBIDDEN / NWIS_BAD_STATE / NWIS_NOT_FOUND to friendly text', () => {
    const forbidden = review.mapReviewError({ code: 'P0001', message: 'NWIS_FORBIDDEN: only reviewer or admin can review fields' });
    expect(forbidden.code).toBe('NWIS_FORBIDDEN');
    expect(forbidden.message).toMatch(/permission/i);
    expect(review.mapReviewError({ message: 'NWIS_BAD_STATE: already reviewed' }).message).toMatch(/already reviewed/i);
    expect(review.mapReviewError({ message: 'NWIS_NOT_FOUND: extracted field not found' }).code).toBe('NWIS_NOT_FOUND');
  });

  it('surfaces the server text for NWIS_BAD_REQUEST (protected column, no target row)', () => {
    const e = review.mapReviewError({ message: 'NWIS_BAD_REQUEST: column wellbore_id is protected and cannot be reviewed' });
    expect(e.code).toBe('NWIS_BAD_REQUEST');
    expect(e.message).toContain('column wellbore_id is protected and cannot be reviewed');
    expect(review.mapReviewError({ message: 'NWIS_BAD_REQUEST: extracted field has no target row to update' }).message).toContain('no target row');
  });

  it('understands NwisApiError codes, RLS errors and unknown errors', () => {
    expect(review.mapReviewError({ code: 'NWIS_FORBIDDEN', message: 'nope', status: 403 }).code).toBe('NWIS_FORBIDDEN');
    expect(review.mapReviewError({ code: '42501', message: 'permission denied' }).code).toBe('NWIS_FORBIDDEN');
    const other = review.mapReviewError(new Error('boom'));
    expect(other.code).toBe('NWIS_INTERNAL');
    expect(other.message).toBe('boom');
  });
});

/* ------------------------------------------------------------------ ReviewDoc: keyboard-only review */

const F = (id, o) => ({
  id, doc_id: 'doc-1', job_id: 'job-1', entity: 'event', entity_id: 'ev-1', review_status: 'pending', reason: null, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.03 },
  confidence: 0.7, page: 1, ...o,
});
const sampleFields = () => [
  F('f1', { field: 'event_type', value: { raw: 'Losses', value: 'loss_partial' } }),
  F('f2', { field: 'md_from_m', value: { raw: '2395 m', value: 2395, unit: 'm' }, reason: 'failed_rule:depth_gt_td' }),
  F('f3', { field: 'formation', value: null, reason: 'unknown_formation', page: 2 }),
];

function setupReviewData(fields = sampleFields()) {
  review.getFieldsForDocument.mockResolvedValue(fields);
  review.getDocumentPages.mockResolvedValue([{ page_no: 1, image_path: 'doc-1/1.png' }, { page_no: 2, image_path: 'doc-1/2.png' }]);
  review.getPageImageUrl.mockImplementation(async (_d, page) => `http://img/${page}.png`);
  review.getFormations.mockResolvedValue([{ name: 'Tipam', strat_order: 5 }, { name: 'Barail', strat_order: 6 }]);
  review.getReviewQueue.mockResolvedValue([{ doc_id: 'doc-2', doc_title: 'Next.pdf', doc_type: 'ddr', pending_count: 2, oldest_at: null }]);
  review.reviewField.mockResolvedValue({});
}

const renderReview = () =>
  render(
    <Routes>
      <Route path="/review/:docId" element={<ReviewDoc />} />
    </Routes>,
    { wrapper: Wrapper }
  );

describe('ReviewDoc keyboard-only review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfile.mockReturnValue({ profile: { role: 'reviewer' } });
    setupReviewData();
  });

  it('reviews a whole document with a / e / r / j / k only, then shows "Document reviewed"', async () => {
    const user = userEvent.setup();
    renderReview();

    // focus starts on the first pending field, with the bbox highlighted
    const first = await screen.findByRole('listitem', { name: /event_type/i });
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.getByTestId('bbox-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-hint')).toHaveTextContent(/approve/i);

    // j moves to the next field, k back
    await user.keyboard('j');
    const second = screen.getByRole('listitem', { name: /md_from_m/i });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-current', 'true');
    await user.keyboard('k');
    expect(first).toHaveFocus();
    await user.keyboard('j');

    // a approves md_from_m (currently selected) and the cursor advances to the next pending field (f1 wraps first? no: f3)
    await user.keyboard('a');
    await waitFor(() => expect(review.reviewField).toHaveBeenCalledWith('f2', 'approve', null));
    // moved to formation on page 2, page image follows
    await screen.findByText(/Page 2 of 2/);
    const third = screen.getByRole('listitem', { name: /formation/i });
    await waitFor(() => expect(third).toHaveFocus());

    // e opens the editor for the formation (select with the formations table), choose and save with Enter
    await user.keyboard('e');
    const select = await screen.findByLabelText(/New value for formation/);
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Barail' })).toBeInTheDocument());
    await user.selectOptions(select, 'Barail');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(review.reviewField).toHaveBeenCalledWith('f3', 'edit', 'Barail'));

    // pending f1 remains: cursor goes back to page 1 and r rejects it
    await screen.findByText(/Page 1 of 2/);
    const firstAgain = screen.getByRole('listitem', { name: /event_type/i });
    await waitFor(() => expect(firstAgain).toHaveFocus());
    await user.keyboard('r');
    await waitFor(() => expect(review.reviewField).toHaveBeenCalledWith('f1', 'reject', null));

    expect(review.reviewField.mock.calls.map((c) => c[1])).toEqual(['approve', 'edit', 'reject']);
    expect(await screen.findByText('Document reviewed')).toBeInTheDocument();
    // next document is offered (and opened automatically after a short delay)
    expect(await screen.findByRole('link', { name: 'Next document' })).toHaveAttribute('href', '/review/doc-2');
  });

  it('typing in the editor never triggers shortcuts', async () => {
    const user = userEvent.setup();
    setupReviewData([F('f1', { field: 'description', value: 'old' })]);
    renderReview();
    await screen.findByRole('listitem', { name: /description/i });
    await user.keyboard('e');
    const input = await screen.findByLabelText(/New value for description/);
    await user.clear(input);
    await user.type(input, 'ark jar');
    expect(review.reviewField).not.toHaveBeenCalled();
    expect(input).toHaveValue('ark jar');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText(/New value for description/)).toBeNull();
  });

  it('shows the mapped server error and keeps the field pending', async () => {
    const user = userEvent.setup();
    review.reviewField.mockRejectedValueOnce(review.mapReviewError({ message: 'NWIS_BAD_REQUEST: column wellbore_id is protected and cannot be reviewed' }));
    renderReview();
    await screen.findByRole('listitem', { name: /event_type/i });
    await user.keyboard('a');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/column wellbore_id is protected/);
    expect(alert).toHaveAttribute('data-error-code', 'NWIS_BAD_REQUEST');
    expect(screen.queryByText('Document reviewed')).toBeNull();
    // still on the same field, still pending: try again works
    review.reviewField.mockResolvedValueOnce({});
    await user.keyboard('a');
    await waitFor(() => expect(review.reviewField).toHaveBeenCalledTimes(2));
    expect(review.reviewField.mock.calls[1][0]).toBe('f1');
  });

  it('maps NWIS_FORBIDDEN and NWIS_BAD_STATE to plain messages on screen', async () => {
    const user = userEvent.setup();
    review.reviewField.mockRejectedValueOnce(review.mapReviewError({ message: 'NWIS_FORBIDDEN: only reviewer or admin can review fields' }));
    renderReview();
    await screen.findByRole('listitem', { name: /event_type/i });
    await user.keyboard('a');
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/i);
    review.reviewField.mockRejectedValueOnce(review.mapReviewError({ message: 'NWIS_BAD_STATE: field already reviewed' }));
    await user.keyboard('r');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already reviewed or changed/i));
  });

  it('is read-only for office engineers: no buttons, shortcuts do nothing, banner explains', async () => {
    const user = userEvent.setup();
    useProfile.mockReturnValue({ profile: { role: 'office_engineer' } });
    renderReview();
    await screen.findByRole('listitem', { name: /event_type/i });
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    await user.keyboard('a');
    await user.keyboard('r');
    await user.keyboard('e');
    expect(review.reviewField).not.toHaveBeenCalled();
    await user.keyboard('j'); // navigation still works
    expect(screen.getByRole('listitem', { name: /md_from_m/i })).toHaveFocus();
  });

  it('an already fully reviewed document says so and offers the queue', async () => {
    setupReviewData([]);
    review.getReviewQueue.mockResolvedValue([]);
    renderReview();
    expect(await screen.findByText('Document reviewed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Back to the queue/ })).toHaveAttribute('href', '/review');
  });

  it('page navigation buttons move between pages and select that page\'s field', async () => {
    const user = userEvent.setup();
    renderReview();
    await screen.findByText(/Page 1 of 2/);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText(/Page 2 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /formation/i })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('reads page images from the separate page-images bucket path {doc}/{page}.png', async () => {
    renderReview();
    await waitFor(() => expect(review.getPageImageUrl).toHaveBeenCalledWith('doc-1', 1, 'doc-1/1.png'));
  });
});

describe('getPageImageUrl bucket', () => {
  it('signs {doc}/{page}.png in the page-images bucket (not documents)', async () => {
    vi.resetModules();
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'http://signed' }, error: null });
    const from = vi.fn(() => ({ createSignedUrl }));
    vi.doMock('../../lib/supabase', () => ({ supabase: { storage: { from } } }));
    const actual = await vi.importActual('../../lib/data/review');
    expect(await actual.getPageImageUrl('doc-9', 3)).toBe('http://signed');
    expect(from).toHaveBeenCalledWith('page-images');
    expect(createSignedUrl).toHaveBeenCalledWith('doc-9/3.png', 3600);
    vi.doUnmock('../../lib/supabase');
  });
});

/* ------------------------------------------------------------------ queue */

describe('ReviewQueue', () => {
  const rows = [
    { doc_id: 'doc-1', doc_title: 'DDR 12.pdf', doc_type: 'ddr', well_name: 'SYN-DLJ-03', pending_count: 7, oldest_at: '2026-09-20T00:00:00Z' },
    { doc_id: 'doc-2', doc_title: 'Mud log.pdf', doc_type: 'mud_log', well_name: null, pending_count: 2, oldest_at: null },
  ];

  it('lists documents with pending counts, type, well and links to /review/:docId', async () => {
    useProfile.mockReturnValue({ profile: { role: 'reviewer' } });
    review.getReviewQueue.mockResolvedValue(rows);
    render(<ReviewQueue />, { wrapper: Wrapper });
    expect(await screen.findByText('DDR 12.pdf')).toBeInTheDocument();
    expect(screen.getByText('SYN-DLJ-03')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review DDR 12.pdf' })).toHaveAttribute('href', '/review/doc-1');
  });

  it('is read-only for office engineers', async () => {
    useProfile.mockReturnValue({ profile: { role: 'office_engineer' } });
    review.getReviewQueue.mockResolvedValue(rows);
    render(<ReviewQueue />, { wrapper: Wrapper });
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View DDR 12.pdf' })).toBeInTheDocument();
  });

  it('shows an empty state and an error state', async () => {
    useProfile.mockReturnValue({ profile: { role: 'reviewer' } });
    review.getReviewQueue.mockResolvedValueOnce([]);
    const { unmount } = render(<ReviewQueue />, { wrapper: Wrapper });
    expect(await screen.findByText(/Queue is empty/)).toBeInTheDocument();
    unmount();
    review.getReviewQueue.mockRejectedValueOnce(new Error('db down'));
    render(<ReviewQueue />, { wrapper: Wrapper });
    expect(await screen.findByRole('alert')).toHaveTextContent(/db down/);
  });
});
