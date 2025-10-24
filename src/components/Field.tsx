import React from 'react';

interface FieldProps {
  label: string;
  children: React.ReactNode;
  hint?: string;
}

export function Field({ label, children, hint }: FieldProps) {
  return (
    <div className="mb-3">
      <label className="block text-sm font-semibold mb-1.5 text-foreground">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
