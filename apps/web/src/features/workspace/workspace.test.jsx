import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { StreamStatusPill } from './StreamStatusPill';

describe('StreamStatusPill', () => {
  it('renders live status', () => {
    render(<StreamStatusPill status="live" lastSampleAt={new Date().toISOString()} />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toBe('live');
    expect(el.className).toMatch(/bg-green-100/);
  });

  it('renders stale status with time ago', () => {
    render(<StreamStatusPill status="stale" lastSampleAt={new Date(Date.now() - 60000).toISOString()} />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toMatch(/last data 1 minute ago/i);
    expect(el.className).toMatch(/bg-amber-100/);
  });

  it('renders lost status', () => {
    render(<StreamStatusPill status="lost" lastSampleAt={new Date(Date.now() - 3600000).toISOString()} />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toMatch(/last data about 1 hour ago/i);
    expect(el.className).toMatch(/bg-red-100/);
  });

  it('renders stopped status', () => {
    render(<StreamStatusPill status="stopped" />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toBe('stopped');
    expect(el.className).toMatch(/bg-gray-100/);
  });
});
