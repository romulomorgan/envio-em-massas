import React from 'react';

interface SmallBtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}

export function SmallBtn({ children, onClick, title, disabled }: SmallBtnProps) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-border bg-secondary hover:bg-accent text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
