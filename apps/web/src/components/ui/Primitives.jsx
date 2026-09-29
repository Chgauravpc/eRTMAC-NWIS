import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function Button({ className, variant = 'primary', ...props }) {
  const base = "px-4 py-2 rounded font-medium focus:outline-none transition-colors";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "bg-gray-200 text-gray-900 hover:bg-gray-300",
    outline: "border border-gray-300 text-gray-700 hover:bg-gray-50",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function Card({ className, ...props }) {
  return <div className={cn("bg-white shadow rounded-lg p-4 border border-gray-200", className)} {...props} />;
}

export function Badge({ className, children, ...props }) {
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800", className)} {...props}>{children}</span>;
}

export function Chip({ className, children, outline, dashed, ...props }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
      outline ? "border border-gray-400 bg-transparent text-gray-700" : "bg-gray-200 text-gray-800",
      dashed && "border-dashed",
      className
    )} {...props}>
      {children}
    </span>
  );
}

export function Spinner({ className }) {
  return <div className={cn("animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600", className)} />;
}

export function EmptyState({ message }) {
  return <div className="text-center py-10 text-gray-500">{message || "No data available."}</div>;
}

export function ErrorState({ message }) {
  return <div className="p-4 bg-red-50 text-red-600 rounded">{message || "An error occurred."}</div>;
}
