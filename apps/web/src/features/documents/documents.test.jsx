import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { UploadDropzone } from './UploadDropzone';
import { DocumentsPage } from './DocumentsPage';
import * as docsData from '../../lib/data/documents';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/data/documents', () => ({
  getUploadUrl: vi.fn(),
  uploadToStorage: vi.fn(),
  submitDocumentRecord: vi.fn()
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  }
}));

describe('UploadDropzone Validation', () => {
  it('rejects unsupported extensions and oversized files', () => {
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    
    let addedFiles = null;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UploadDropzone onFilesAdded={(f) => addedFiles = f} />
      </QueryClientProvider>
    );
    
    const input = document.querySelector('input[type="file"]');
    const badExt = new File([''], 'test.exe', { type: 'application/x-msdownload' });
    const hugeFile = new File([new ArrayBuffer(26 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
    const goodFile = new File([''], 'test.pdf', { type: 'application/pdf' });
    
    // JS dom won't normally allow array buffer sizes in testing effectively but this fakes the object properties
    Object.defineProperty(hugeFile, 'size', { value: 26 * 1024 * 1024 });
    
    fireEvent.change(input, { target: { files: [badExt, hugeFile, goodFile] } });
    
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('unsupported type'));
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('too large'));
    
    expect(addedFiles).toBeTruthy();
    expect(addedFiles.length).toBe(1);
    expect(addedFiles[0].file.name).toBe('test.pdf');
    
    alertMock.mockRestore();
  });
});

describe('DocumentsPage Flow State Machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TestWrapper = ({ children }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );

  it('progresses through getUploadUrl -> uploadToStorage -> submitDocumentRecord', async () => {
    docsData.getUploadUrl.mockResolvedValue({ 
      upload_id: '123', storage_path: 'path/doc.pdf', signed_url: 'http', token: 'tok' 
    });
    docsData.uploadToStorage.mockImplementation(async (a,b,c, progress) => {
      progress(100);
      return true;
    });
    docsData.submitDocumentRecord.mockResolvedValue({
      document_id: 'd1', job_id: 'j1', duplicate: false
    });

    const { container } = render(<DocumentsPage />, { wrapper: TestWrapper });

    const input = document.querySelector('input[type="file"]');
    const goodFile = new File([''], 'flow.pdf', { type: 'application/pdf' });
    
    fireEvent.change(input, { target: { files: [goodFile] } });

    await waitFor(() => {
      expect(docsData.getUploadUrl).toHaveBeenCalled();
    });
    
    await waitFor(() => {
      expect(docsData.uploadToStorage).toHaveBeenCalled();
    });
    
    await waitFor(() => {
      expect(docsData.submitDocumentRecord).toHaveBeenCalled();
    });
    
    // Check if job progress component rendered (which means status is processing)
    await waitFor(() => {
      expect(container.innerHTML).toContain('Processing'); // Stage default
    });
  });

  it('handles duplicate file', async () => {
    docsData.getUploadUrl.mockResolvedValue({ upload_id: '123', storage_path: 'p', signed_url: 's', token: 't' });
    docsData.uploadToStorage.mockResolvedValue(true);
    docsData.submitDocumentRecord.mockResolvedValue({ document_id: 'd1', duplicate: true });

    const { getByText } = render(<DocumentsPage />, { wrapper: TestWrapper });

    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File([''], 'dup.pdf', { type: 'application/pdf' })] } });

    await waitFor(() => {
      expect(getByText(/Already in the library/i)).toBeTruthy();
    });
  });

  it('handles errors and shows retry', async () => {
    docsData.getUploadUrl.mockRejectedValue(new Error('Network fail'));

    const { getByText, findByText } = render(<DocumentsPage />, { wrapper: TestWrapper });

    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File([''], 'err.pdf', { type: 'application/pdf' })] } });

    const retryBtn = await findByText('Retry Upload');
    expect(retryBtn).toBeTruthy();
    expect(getByText(/Network fail/i)).toBeTruthy();
  });
});
