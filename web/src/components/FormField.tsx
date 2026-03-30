interface FormFieldProps {
  label: string
  error?: string
  children: React.ReactNode
}

export function FormField({ label, error, children }: FormFieldProps) {
  return (
    <div className="field-root">
      <label className="field-label">{label}</label>
      {children}
      {error && <p className="field-error">{error}</p>}
      <style>{`
        .field-root { display: flex; flex-direction: column; gap: 6px; }
        .field-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: #a1a1aa;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .field-error {
          font-size: 0.78rem;
          color: #f87171;
          margin: 0;
        }
        input.field-input, select.field-input {
          background: #09090b;
          border: 1px solid #3f3f46;
          border-radius: 10px;
          color: #f4f4f5;
          font-family: inherit;
          font-size: 0.9375rem;
          padding: 0.65rem 0.875rem;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          width: 100%;
        }
        input.field-input:focus, select.field-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
        }
        input.field-input::placeholder { color: #52525b; }
      `}</style>
    </div>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}
export function Input({ error: _error, ...props }: InputProps) {
  return <input className="field-input" {...props} />
}
