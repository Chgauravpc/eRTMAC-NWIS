import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnswerView } from './AnswerView';

describe('AnswerView parsing', () => {
  it('parses single citations like [1]', () => {
    const citations = [{ n: 1, doc_title: 'WCR-01', page: 5, chunk_id: 'c1', snippet: 'test' }];
    render(<AnswerView answer_md="This is a test [1]." citations={citations} evidence="sufficient" />);
    
    // The citation chip should exist
    const chip = screen.getByText('1');
    expect(chip).toBeDefined();
    
    // It should render "WCR-01" in the sources list below
    const sourcesList = screen.getByText('Sources Referenced').parentElement;
    expect(within(sourcesList).getByText('WCR-01')).toBeDefined();
  });

  it('parses adjacent citations like [1][3]', () => {
    const citations = [
      { n: 1, doc_title: 'WCR-01', page: 5, chunk_id: 'c1' },
      { n: 3, doc_title: 'WCR-02', page: 2, chunk_id: 'c3' }
    ];
    render(<AnswerView answer_md="Test [1][3]." citations={citations} evidence="sufficient" />);
    
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('handles unknown numbers gracefully', () => {
    const citations = [{ n: 1, doc_title: 'WCR-01', page: 5, chunk_id: 'c1' }];
    render(<AnswerView answer_md="Test [1] and [9]." citations={citations} evidence="sufficient" />);
    
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    
    // 9 shouldn't be a chip button, just raw text "[9]"
    const rawText = screen.getByText(/\[9\]/);
    expect(rawText).toBeDefined();
  });

  it('shows neutral box for insufficient evidence', () => {
    const closest = [{ chunk_id: 'c1', doc_title: 'DDR-44', page: 12 }];
    render(<AnswerView answer_md="Not found." citations={closest} evidence="insufficient" />);
    
    expect(screen.getByText('Not enough evidence')).toBeDefined();
    expect(screen.getByText('DDR-44')).toBeDefined();
  });
});
