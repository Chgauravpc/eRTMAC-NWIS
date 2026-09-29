import React from 'react';
import { cn, FOCUS_RING } from './cn';

/**
 * Simple data table.
 *   <Table columns={[{ key, header, render?(row), className?, align? }]} rows={[]} rowKey="id"
 *          onRowClick={fn} caption="..." empty="Nothing here" />
 * rowKey is a field name or a function(row). Rows are keyboard-activatable when onRowClick is set.
 */
export function Table({ columns, rows, rowKey = 'id', onRowClick, caption, empty = 'No rows.', className }) {
  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] ?? i));
  return (
    <div className={cn('overflow-x-auto rounded border border-gray-200', className)}>
      <table className="min-w-full text-sm text-left">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-3 py-2 font-semibold', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-500">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn(onRowClick && ['cursor-pointer hover:bg-gray-50', FOCUS_RING])}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2', c.align === 'right' && 'text-right', c.className)}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
