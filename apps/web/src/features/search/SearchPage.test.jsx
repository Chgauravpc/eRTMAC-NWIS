import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import React from 'react';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { SearchPage } from './SearchPage';
import { splitHighlight } from './Highlighted';
import { buildSearchBody } from './SearchResults';
import { buildAskBody } from './AskPanel';
import { createServer, renderRoute, allowRelativeFetch } from '../wells/testHarness';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
vi.mock('../../lib/supabase', async () => ({ supabase: await (await import('../wells/testHarness')).createTestSupabase() }));

const server = createServer();
let restoreFetch;
beforeAll(() => {
  restoreFetch = allowRelativeFetch();
  server.listen({ onUnhandledRequest: 'bypass' });
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  restoreFetch();
});

const RESULT = {
  chunk_id: 'c1',
  doc_id: 'd1',
  doc_title: 'WCR report.pdf',
  page: 7,
  snippet: 'Partial losses of 15 m3/h were seen in the Tipam sand.',
  well_name: 'Well A',
  formation: 'Tipam',
  score: 0.03,
};

const render = (route = '/search') => renderRoute(<SearchPage />, { path: '/search', route });

describe('highlighting never builds HTML', () => {
  it('marks query words (3+ characters) and leaves everything else as text', () => {
    expect(splitHighlight('Partial losses in Tipam', 'losses tipam')).toEqual([
      { text: 'Partial ', hit: false },
      { text: 'losses', hit: true },
      { text: ' in ', hit: false },
      { text: 'Tipam', hit: true },
    ]);
    expect(splitHighlight('no terms', 'a b')).toEqual([{ text: 'no terms', hit: false }]);
    expect(splitHighlight('', 'losses')).toEqual([{ text: '', hit: false }]);
  });

  it('treats regex characters in the query literally', () => {
    expect(() => splitHighlight('cost (a+b) here', 'a+b ((( [x')).not.toThrow();
  });
});

describe('request bodies (contract 9.2)', () => {
  it('turns empty filters into null and depths into numbers', () => {
    expect(buildSearchBody('losses', { formation: 'Tipam', event_type: '', field: '', md_from: '1000', md_to: '' })).toEqual({
      q: 'losses',
      filters: { formation: 'Tipam', event_type: null, field: null, md_from: 1000, md_to: null },
      limit: 20,
    });
    expect(buildAskBody('why?', {})).toEqual({
      question: 'why?',
      filters: { formation: null, event_type: null, field: null, md_from: null, md_to: null },
      wellbore_id: null,
    });
  });
});

describe('SearchPage', () => {
  it('opens on Ask, switches to Search, and keeps both panels', async () => {
    render();
    expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Ask a question')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Search reports')).toBeVisible();
    expect(screen.queryByLabelText('Ask a question')).not.toBeVisible();
  });

  it('sends the shared filters with the search and shows the results with the query marked', async () => {
    let body;
    server.use(
      http.post('/api/search', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ results: [RESULT] });
      }),
    );
    render();
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    await waitFor(() => expect(within(screen.getByLabelText('Formation')).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Formation'), { target: { value: within(screen.getByLabelText('Formation')).getAllByRole('option')[1].value } });
    fireEvent.change(screen.getByLabelText('Depth from (m)'), { target: { value: '1200' } });
    fireEvent.change(screen.getByLabelText('Depth from (m)'), { target: { value: 'abc' } }); // rejected: digits only
    fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'losses' } });
    fireEvent.submit(screen.getByRole('search'));

    const item = await screen.findByText('WCR report.pdf');
    expect(body.q).toBe('losses');
    expect(body.filters.md_from).toBe(1200);
    expect(body.filters.formation).toBeTruthy();
    const row = item.closest('li');
    expect(within(row).getByText('Page 7')).toBeInTheDocument();
    expect(within(row).getByText('Well A')).toBeInTheDocument();
    expect(row.querySelector('mark').textContent).toBe('losses');
  });

  it('shows a snippet containing markup as plain text (no injected elements)', async () => {
    server.use(
      http.post('/api/search', () =>
        HttpResponse.json({ results: [{ ...RESULT, snippet: 'bad <img src=x onerror="alert(1)"> text <b>bold</b>' }] }),
      ),
    );
    render();
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'bad' } });
    fireEvent.submit(screen.getByRole('search'));
    const item = (await screen.findByText('WCR report.pdf')).closest('li');
    expect(item.querySelector('img')).toBeNull();
    expect(item.querySelector('b')).toBeNull();
    expect(item.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('says so when nothing matches and when the search fails', async () => {
    server.use(http.post('/api/search', () => HttpResponse.json({ results: [] })));
    render();
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'zzzz' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();

    server.use(http.post('/api/search', () => HttpResponse.json({ error: { code: 'NWIS_UPSTREAM', message: 'Space asleep' } }, { status: 502 })));
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Space asleep');
  });

  it('a query from the top bar (?q=) opens the Search tab and runs it', async () => {
    let calls = 0;
    server.use(
      http.post('/api/search', () => {
        calls += 1;
        return HttpResponse.json({ results: [RESULT] });
      }),
    );
    render('/search?q=tipam');
    expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('WCR report.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('Search reports')).toHaveValue('tipam');
    expect(calls).toBe(1);
  });

  it('warns when the depth range is reversed and can clear the filters', async () => {
    render();
    fireEvent.change(screen.getByLabelText('Depth from (m)'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Depth to (m)'), { target: { value: '1000' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/must not be greater/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Depth from (m)')).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the Ask tab sends the question and renders the cited answer; the example chips ask too', async () => {
    let body;
    server.use(
      http.post('/api/ask', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          answer_md: 'LCM pills worked [1].',
          evidence: 'sufficient',
          citations: [{ n: 1, chunk_id: 'c1', doc_id: 'd1', doc_title: 'WCR report.pdf', page: 4, snippet: 'Pumped LCM pill' }],
          provider: 'groq',
          cached: true,
        });
      }),
    );
    render();
    fireEvent.click(screen.getByRole('button', { name: 'What worked for mud losses in Tipam?' }));
    expect(await screen.findByText(/LCM pills worked/)).toBeInTheDocument();
    expect(body.question).toBe('What worked for mud losses in Tipam?');
    expect(screen.getByText('cached')).toBeInTheDocument();
    expect(screen.getByText('Provider: groq')).toBeInTheDocument();
  });
});
