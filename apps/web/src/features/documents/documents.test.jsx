import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UploadDropzone } from './UploadDropzone';
import { DocumentsPage } from './DocumentsPage';
import { JobProgress } from './JobProgress';
import { stageIndex, stageLabel } from './stages';
import { validateFile, MAX_FILE_BYTES, ALLOWED_EXTENSIONS } from './validate';
import * as docsData from '../../lib/data/documents';

vi.mock('../../lib/data/documents', () => ({
  getUploadUrl: vi.fn(),
  uploadToStorage: vi.fn(),
  submitDocumentRecord: vi.fn(),
  listDocuments: vi.fn(),
  getWellOptions: vi.fn(),
  getJob: vi.fn(),
  getJobSummary: vi.fn(),
}));

// Realtime bus stub: tests push job rows through `emitJob`.
const listeners = [];
vi.mock('../../lib/realtime', () => ({
  subscribe: (table, filter, cb) => {
    const l = { table, filter, cb };
    listeners.push(l);
    return () => listeners.splice(listeners.indexOf(l), 1);
  },
}));
const emitJob = (row) =>
  act(() => {
    listeners
      .filter((l) => l.table === 'jobs' && (!l.filter || l.filter === `id=eq.${row.id}`))
      .forEach((l) => l.cb({ new: row }));
  });

const Wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const pdf = (name = 'flow.pdf') => new File(['x'], name, { type: 'application/pdf' });
const pick = (files) => fireEvent.change(document.querySelector('input[type="file"]'), { target: { files } });

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
  docsData.listDocuments.mockResolvedValue([]);
  docsData.getWellOptions.mockResolvedValue([{ well_id: 'w1', wellbore_id: 'wb1', well_name: 'SYN-DLJ-03' }]);
  docsData.getJob.mockResolvedValue(null);
  docsData.getJobSummary.mockResolvedValue({ events: 0, pending: 0 });
  docsData.getUploadUrl.mockResolvedValue({ upload_id: 'u1', storage_path: 'incoming/u1/flow.pdf', signed_url: 'https://s/x?token=t', token: 't' });
  docsData.uploadToStorage.mockResolvedValue({ path: 'incoming/u1/flow.pdf' });
  docsData.submitDocumentRecord.mockResolvedValue({ document_id: 'd1', job_id: 'j1', duplicate: false });
});

describe('validateFile (client checks)', () => {
  it('accepts every allowed type, case-insensitively', () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(validateFile({ name: `file${ext.toUpperCase()}`, size: 10 }).ok).toBe(true);
    }
    for (const name of ['a.pdf', 'a.png', 'a.jpg', 'a.tiff', 'a.csv', 'a.xlsx', 'a.xml', 'a.las', 'a.txt']) {
      expect(validateFile({ name, size: 1 }).ok).toBe(true);
    }
  });

  it('rejects unsupported types and names without an extension', () => {
    const exe = validateFile({ name: 'virus.exe', size: 10 });
    expect(exe).toMatchObject({ ok: false, code: 'type' });
    expect(exe.message).toMatch(/unsupported file type/i);
    expect(validateFile({ name: 'README', size: 10 })).toMatchObject({ ok: false, code: 'type' });
    expect(validateFile({ name: 'x.docx', size: 10 }).ok).toBe(false);
  });

  it('rejects files over 25 MB but accepts exactly 25 MB', () => {
    expect(validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES }).ok).toBe(true);
    const big = validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES + 1 });
    expect(big).toMatchObject({ ok: false, code: 'size' });
    expect(big.message).toMatch(/25 MB/);
  });
});

describe('UploadDropzone', () => {
  it('shows inline errors (no window.alert) and only passes valid files on', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const added = vi.fn();
    render(<UploadDropzone onFilesAdded={added} />, { wrapper: Wrapper });

    const bad = new File([''], 'test.exe', { type: 'application/x-msdownload' });
    const huge = new File([''], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 });
    pick([bad, huge, pdf('test.pdf')]);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unsupported file type/i);
    expect(alert).toHaveTextContent(/too large/i);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(added).toHaveBeenCalledTimes(1);
    expect(added.mock.calls[0][0].map((e) => e.file.name)).toEqual(['test.pdf']);
    alertSpy.mockRestore();
  });

  it('offers contract doc types and provenances and sends well ids with each file', async () => {
    const added = vi.fn();
    render(<UploadDropzone onFilesAdded={added} />, { wrapper: Wrapper });
    const types = [...screen.getByLabelText('Document type').querySelectorAll('option')].map((o) => o.value);
    expect(types).toEqual(['', 'wcr', 'ddr', 'mud_log', 'program', 'cement_report', 'incident', 'survey', 'las', 'witsml', 'other']);
    const prov = [...screen.getByLabelText('Provenance').querySelectorAll('option')].map((o) => o.value);
    expect(prov).toEqual(['direct', 'analog', 'synthetic']);

    await waitFor(() => expect(screen.getByRole('option', { name: 'SYN-DLJ-03' })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/Target well/i), 'wb1');
    await userEvent.selectOptions(screen.getByLabelText('Document type'), 'ddr');
    pick([pdf('a.pdf'), pdf('b.pdf')]);
    expect(added.mock.calls[0][0]).toHaveLength(2);
    expect(added.mock.calls[0][0][0]).toMatchObject({ wellId: 'w1', wellboreId: 'wb1', docType: 'ddr', provenance: 'direct' });
  });

  it('opens the file picker with the keyboard (Enter on the drop area)', async () => {
    render(<UploadDropzone onFilesAdded={() => {}} />, { wrapper: Wrapper });
    const input = document.querySelector('input[type="file"]');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const zone = screen.getByRole('button', { name: /Upload documents/i });
    zone.focus();
    await userEvent.keyboard('{Enter}');
    expect(click).toHaveBeenCalled();
  });
});

describe('DocumentsPage upload flow state machine', () => {
  it('runs getUploadUrl -> uploadToStorage -> submitDocumentRecord and then shows the first job stage', async () => {
    render(<DocumentsPage />, { wrapper: Wrapper });
    pick([pdf()]);

    await waitFor(() => expect(docsData.submitDocumentRecord).toHaveBeenCalled());
    expect(docsData.getUploadUrl).toHaveBeenCalledTimes(1);
    // bytes go to the signed URL returned by step 1
    expect(docsData.uploadToStorage).toHaveBeenCalledWith('incoming/u1/flow.pdf', 't', expect.any(File), expect.any(Function), 'https://s/x?token=t');
    expect(docsData.submitDocumentRecord).toHaveBeenCalledWith({
      storage_path: 'incoming/u1/flow.pdf',
      filename: 'flow.pdf',
      well_id: null,
      wellbore_id: null,
      doc_type: null,
      provenance: 'direct',
    });
    // job appears: "Queued" first, then the stage from Realtime
    expect(await screen.findByRole('progressbar', { name: /processing progress/i })).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    await emitJob({ id: 'j1', status: 'running', stage: 'classify', progress: 10 });
    expect(screen.getAllByText('Classify').length).toBeGreaterThan(0);
  });

  it('wires REAL upload progress from the storage callback to the progress bar', async () => {
    let report;
    let finish;
    docsData.uploadToStorage.mockImplementation((_p, _t, _f, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<DocumentsPage />, { wrapper: Wrapper });
    pick([pdf()]);

    const bar = await screen.findByRole('progressbar', { name: /Uploading flow\.pdf/i });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    act(() => report(37));
    expect(screen.getByRole('progressbar', { name: /Uploading flow\.pdf/i })).toHaveAttribute('aria-valuenow', '37');
    act(() => report(81));
    expect(screen.getByRole('progressbar', { name: /Uploading flow\.pdf/i })).toHaveAttribute('aria-valuenow', '81');
    expect(docsData.submitDocumentRecord).not.toHaveBeenCalled(); // not registered until all bytes are stored
    await act(async () => finish({}));
    await waitFor(() => expect(docsData.submitDocumentRecord).toHaveBeenCalled());
  });

  it('handles a duplicate file with "Already in the library" and a link', async () => {
    docsData.submitDocumentRecord.mockResolvedValue({ document_id: 'dup-1', job_id: null, duplicate: true });
    render(<DocumentsPage />, { wrapper: Wrapper });
    pick([pdf('dup.pdf')]);

    expect(await screen.findByText(/Already in the library/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View existing/i })).toHaveAttribute('href', '/search?doc=dup-1');
    expect(screen.queryByRole('progressbar', { name: /processing progress/i })).not.toBeInTheDocument();
  });

  it('shows the error and "Retry Upload" when the URL request fails, and retry restarts the whole flow', async () => {
    docsData.getUploadUrl.mockRejectedValueOnce(new Error('Network fail'));
    render(<DocumentsPage />, { wrapper: Wrapper });
    pick([pdf('err.pdf')]);

    const retry = await screen.findByRole('button', { name: /Retry Upload/i });
    expect(screen.getByRole('alert')).toHaveTextContent(/Network fail/);
    await userEvent.click(retry);
    await waitFor(() => expect(docsData.submitDocumentRecord).toHaveBeenCalledTimes(1));
    expect(docsData.getUploadUrl).toHaveBeenCalledTimes(2);
    expect(docsData.uploadToStorage).toHaveBeenCalledTimes(1);
  });

  it('retry after a failed registration re-POSTs /api/documents only (no second upload)', async () => {
    docsData.submitDocumentRecord.mockRejectedValueOnce(new Error('Space unavailable'));
    render(<DocumentsPage />, { wrapper: Wrapper });
    pick([pdf()]);

    const retry = await screen.findByRole('button', { name: /Retry processing/i });
    expect(screen.getByRole('alert')).toHaveTextContent(/Space unavailable/);
    await userEvent.click(retry);
    await waitFor(() => expect(docsData.submitDocumentRecord).toHaveBeenCalledTimes(2));
    expect(docsData.getUploadUrl).toHaveBeenCalledTimes(1);
    expect(docsData.uploadToStorage).toHaveBeenCalledTimes(1);
    expect(docsData.submitDocumentRecord.mock.calls[1][0].storage_path).toBe('incoming/u1/flow.pdf');
  });

  it('a job that fails after processing started shows the error and retries by re-POSTing only', async () => {
    render(<DocumentsPage />, { wrapper: Wrapper });
    pick([pdf()]);
    await screen.findByRole('progressbar', { name: /processing progress/i });

    await emitJob({ id: 'j1', status: 'failed', stage: 'ocr', progress: 40, error: 'OCR engine crashed' });
    expect(await screen.findByText(/OCR engine crashed/)).toBeInTheDocument();
    docsData.submitDocumentRecord.mockResolvedValueOnce({ document_id: 'd1', job_id: 'j2', duplicate: false });
    await userEvent.click(screen.getByRole('button', { name: /Retry processing/i }));

    await waitFor(() => expect(docsData.submitDocumentRecord).toHaveBeenCalledTimes(2));
    expect(docsData.getUploadUrl).toHaveBeenCalledTimes(1);
    expect(docsData.uploadToStorage).toHaveBeenCalledTimes(1);
    // the new job is now the one being watched
    await waitFor(() => expect(listeners.some((l) => l.filter === 'id=eq.j2')).toBe(true));
  });
});

describe('JobProgress', () => {
  it('maps jobs.stage to the five PRD stage names', () => {
    const stages = [['classify', 'Classify'], ['ocr', 'Read/OCR'], ['extract', 'Extract'], ['validate', 'Validate'], ['index', 'Index']];
    stages.forEach(([stage, label], i) => {
      const job = { status: 'running', stage };
      expect(stageIndex(job)).toBe(i);
      expect(stageLabel(job)).toBe(label);
    });
    expect(stageLabel({ status: 'queued', stage: null })).toBe('Queued');
    expect(stageIndex({ status: 'done', stage: 'done' })).toBe(5);
  });

  it('highlights the current stage live and reports progress', async () => {
    render(<JobProgress jobId="j9" docId="d9" />, { wrapper: Wrapper });
    await emitJob({ id: 'j9', status: 'running', stage: 'extract', progress: 70 });
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['Classify', 'Read/OCR', 'Extract', 'Validate', 'Index']);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('progressbar', { name: /processing progress/i })).toHaveAttribute('aria-valuenow', '70');
  });

  it('done -> "Ready: N events extracted" with search and review links', async () => {
    docsData.getJobSummary.mockResolvedValue({ events: 4, pending: 0 });
    render(<JobProgress jobId="j9" docId="d9" />, { wrapper: Wrapper });
    await emitJob({ id: 'j9', status: 'done', stage: 'done', progress: 100 });
    expect(await screen.findByText(/Ready: 4 events extracted/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View in search/i })).toHaveAttribute('href', '/search?doc=d9');
    expect(screen.getByRole('link', { name: /Review/i })).toHaveAttribute('href', '/review/d9');
  });

  it('needs_review is read from status (there is no needs_review column) and links to /review/<docId>', async () => {
    docsData.getJobSummary.mockResolvedValue({ events: 2, pending: 5 });
    render(<JobProgress jobId="j9" docId="d9" />, { wrapper: Wrapper });
    await emitJob({ id: 'j9', status: 'needs_review', stage: 'index', progress: 100 });
    expect(await screen.findByText(/5 fields need review/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review now/i })).toHaveAttribute('href', '/review/d9');
    expect(docsData.getJobSummary).toHaveBeenCalledWith('d9');
  });

  it('failed shows jobs.error and calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<JobProgress jobId="j9" docId="d9" onRetry={onRetry} />, { wrapper: Wrapper });
    await emitJob({ id: 'j9', status: 'failed', stage: 'ocr', progress: 40, error: 'page 4 unreadable' });
    expect(await screen.findByText(/page 4 unreadable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry processing/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('picks up the current state from the initial read (missed events)', async () => {
    docsData.getJob.mockResolvedValue({ id: 'j9', status: 'running', stage: 'validate', progress: 90 });
    render(<JobProgress jobId="j9" docId="d9" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByRole('progressbar', { name: /processing progress/i })).toHaveAttribute('aria-valuenow', '90'));
  });
});
