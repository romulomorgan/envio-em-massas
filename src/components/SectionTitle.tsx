import React from 'react';

interface SectionTitleProps {
  children: React.ReactNode;
  right?: React.ReactNode;
}

export function SectionTitle({ children, right }: SectionTitleProps) {
  return (
    <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
      <h2 className="text-xl font-bold text-foreground">{children}</h2>
      {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}
