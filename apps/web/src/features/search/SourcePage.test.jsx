import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SourcePage, pageFromQuery } from './SourcePage';
import { sourceHref } from '../alerts/sourceLink';

const h = vi.hoisted(() => ({ result: { data: null, error: null } }));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(h.result) }) }) }) },
}));
vi.mock('./SourceViewer', () => ({
  SourceViewer: ({ source }) => (
    <div role="dialog" aria-label="drawer" data-doc={source.doc_id} data-page={source.page}>
      {source.doc_title}
    </div>
  ),
}));

const renderAt = (url) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/sources/:docId" element={<SourcePage />} />
          <Route path="/search" element={<p>SEARCH</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  h.result = { data: { id: 'doc-1', title: 'WCR report.pdf' }, error: null };
});

describe('pageFromQuery', () => {
  it('accepts whole numbers from 1 and falls back to page 1', () => {
    expect(pageFromQuery('7')).toBe(7);
    expect(pageFromQuery(null)).toBe(1);
    expect(pageFromQuery('0')).toBe(1);
    expect(pageFromQuery('-3')).toBe(1);
    expect(pageFromQuery('2.5')).toBe(1);
    expect(pageFromQuery('abc')).toBe(1);
  });
});

describe('SourcePage (the target of every evidence link)', () => {
  it('opens the drawer for the cited page of the document', async () => {
    renderAt(sourceHref('doc-1', 4));
    const drawer = await screen.findByRole('dialog', { name: 'drawer' });
    expect(drawer).toHaveAttribute('data-doc', 'doc-1');
    expect(drawer).toHaveAttribute('data-page', '4');
    expect(screen.getByRole('heading', { name: 'WCR report.pdf' })).toBeInTheDocument();
    expect(screen.getByText('Page 4')).toBeInTheDocument();
  });

  it('defaults to page 1 when the link has no page', async () => {
    renderAt(sourceHref('doc-1'));
    expect(await screen.findByRole('dialog', { name: 'drawer' })).toHaveAttribute('data-page', '1');
  });

  it('says so when the document does not exist or is not visible', async () => {
    h.result = { data: null, error: null };
    renderAt('/sources/missing?page=2');
    expect(await screen.findByRole('alert')).toHaveTextContent('This document was not found');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: /Search & Ask/ })).toHaveAttribute('href', '/search');
  });

  it('shows the error when the lookup fails', async () => {
    h.result = { data: null, error: { message: 'permission denied' } };
    renderAt('/sources/doc-1?page=2');
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
  });
});
