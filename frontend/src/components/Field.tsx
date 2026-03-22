import { ReactNode } from 'react';

interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  isEditing?: boolean;
}

export function Field({ label, children, isEditing = false }: FieldProps) {
  return (
    <div className="relative rounded">
      <div className="relative inline-flex gap-2 text-gray-500">{label}</div>
      {children}
    </div>
  );
}

interface FieldLabelProps {
  children: ReactNode;
}

export function FieldLabel({ children }: FieldLabelProps) {
  return <p>{children}</p>;
}

interface FieldValueProps {
  children: ReactNode;
  className?: string;
}

export function FieldValue({ children, className = '' }: FieldValueProps) {
  return <p className={`text-lg font-medium ${className}`}>{children}</p>;
}

interface FieldActionsProps {
  children: ReactNode;
}

export function FieldActions({ children }: FieldActionsProps) {
  return <div className="inline-flex gap-2">{children}</div>;
}
