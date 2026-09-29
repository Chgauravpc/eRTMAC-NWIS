import React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn, FOCUS_RING } from './cn';

export { cn, FOCUS_RING };

const BUTTON_VARIANTS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600',
  secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:hover:bg-gray-200',
  outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:hover:bg-transparent',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:hover:bg-transparent',
};
const BUTTON_SIZES = { sm: 'px-3 py-1 text-sm', md: 'px-4 py-2', lg: 'px-5 py-3 text-lg' };

/** Button. variant: primary | secondary | outline | danger | ghost. size: sm | md | lg. */
export function Button({ className, variant = 'primary', size = 'md', ...props }) {
  return (
    <button
      className={cn(
        'rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        FOCUS_RING,
        BUTTON_SIZES[size] || BUTTON_SIZES.md,
        BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary,
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }) {
  return <div className={cn('bg-white shadow rounded-lg p-4 border border-gray-200', className)} {...props} />;
}

export function Badge({ className, children, ...props }) {
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800', className)}
      {...props}
    >
      {children}
    </span>
  );
}

/** Chip. `outline` = bordered, `dashed` = dashed border (used for Low confidence). */
export function Chip({ className, children, outline, dashed, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        outline ? 'border border-gray-400 bg-transparent text-gray-700' : 'bg-gray-200 text-gray-800',
        dashed && 'border border-dashed border-gray-500',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600', className)}
    />
  );
}

/**
 * Empty state. Props: message, title, icon (lucide component), action (node), className.
 * Also used for "coming soon" pages so they look intentional.
 */
export function EmptyState({ message, title, icon: Icon = Inbox, action, className }) {
  return (
    <div className={cn('flex flex-col items-center text-center py-10 px-4 text-gray-500', className)}>
      <Icon className="h-8 w-8 mb-3 text-gray-400" aria-hidden="true" />
      {title && <h2 className="text-lg font-semibold text-gray-800 mb-1">{title}</h2>}
      <p>{message || 'No data available.'}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Error state with an optional Retry button (onRetry). */
export function ErrorState({ message, title, onRetry, className }) {
  return (
    <div role="alert" className={cn('p-4 bg-red-50 text-red-700 rounded border border-red-200', className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          {title && <div className="font-semibold">{title}</div>}
          <div>{message || 'An error occurred.'}</div>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-3 bg-white" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
