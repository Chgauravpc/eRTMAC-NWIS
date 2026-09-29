import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, Table, Dialog, ToastProvider, useToast, Slider, Select, Button, EmptyState, ErrorState, Spinner } from './index';

function DialogHarness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open it</button>
      <Dialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Resolve alert"
        footer={<Button>Save</Button>}
      >
        <input aria-label="note" />
      </Dialog>
    </div>
  );
}

describe('Dialog', () => {
  it('has dialog semantics, traps focus, closes on Esc and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByText('open it');
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Resolve alert' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // first focusable is the close button; Tab cycles inside and never leaves
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('note')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('Toast', () => {
  function Fire() {
    const toast = useToast();
    return (
      <>
        <button onClick={() => toast.success('Saved it')}>ok</button>
        <button onClick={() => toast.error('Broke it')}>bad</button>
      </>
    );
  }
  it('announces toasts in live regions and auto-dismisses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider defaultDuration={1000}>
        <Fire />
      </ToastProvider>,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByText('ok'));
    await user.click(screen.getByText('bad'));
    expect(screen.getByText('Saved it').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Broke it').closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText('Saved it')).toBeNull();
    vi.useRealTimers();
  });
  it('useToast is a safe no-op outside a provider', async () => {
    render(<Fire />);
    await userEvent.click(screen.getByText('ok'));
  });
});

describe('Tabs', () => {
  it('switches with click and arrow keys', async () => {
    const user = userEvent.setup();
    render(<Tabs tabs={[{ id: 'a', label: 'Alpha', content: 'A body' }, { id: 'b', label: 'Beta', content: 'B body' }]} />);
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('A body');
    await user.click(screen.getByRole('tab', { name: 'Alpha' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B body');
  });
});

describe('Table', () => {
  it('renders rows, empty state and keyboard-activatable rows', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const cols = [{ key: 'name', header: 'Name' }, { key: 'n', header: 'N', render: (r) => `#${r.n}` }];
    const { rerender } = render(<Table columns={cols} rows={[{ id: 1, name: 'SYN-A', n: 3 }]} onRowClick={onRowClick} caption="wells" />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    screen.getByText('SYN-A').closest('tr').focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith({ id: 1, name: 'SYN-A', n: 3 });
    rerender(<Table columns={cols} rows={[]} empty="Nothing" />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });
});

describe('Slider and Select', () => {
  it('Slider reports numbers and shows the formatted value', () => {
    const onChange = vi.fn();
    render(<Slider label="Radius" value={10} min={1} max={25} onChange={onChange} format={(n) => `${n} km`} />);
    const input = screen.getByLabelText('Radius');
    expect(screen.getByText('10 km')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith(12);
  });
  it('Select maps string and object options and a placeholder', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Formation" value="" onChange={onChange} placeholder="All" options={['Tipam', { value: 'b', label: 'Barail' }]} />);
    await user.selectOptions(screen.getByLabelText('Formation'), 'b');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
  });
});

describe('states', () => {
  it('EmptyState, ErrorState (with retry) and Spinner', async () => {
    const onRetry = vi.fn();
    render(
      <>
        <EmptyState title="Nothing yet" message="Add something" />
        <ErrorState message="Failed" onRetry={onRetry} />
        <Spinner />
      </>,
    );
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
