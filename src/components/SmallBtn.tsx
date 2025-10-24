import React from 'react';

interface SmallBtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
}

export function SmallBtn({ children, onClick, title, disabled, variant = 'secondary' }: SmallBtnProps) {
  const variantClasses = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary',
    secondary: 'bg-secondary hover:bg-accent border-border',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 border-destructive'
  };

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
