import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

type FieldBase = { label: string; hint?: string; error?: string; requiredLabel?: string };

function FieldFrame({
  id,
  label,
  hint,
  error,
  required,
  requiredLabel,
  children,
}: FieldBase & { id: string; required?: boolean; children: ReactNode }) {
  const descriptionId = hint || error ? `${id}-description` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="field__required"> {requiredLabel ?? '*'}</span> : null}
      </label>
      {children}
      {hint || error ? (
        <p id={descriptionId} className={error ? 'field__error' : 'field__hint'}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  requiredLabel,
  id,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldBase & { id: string }) {
  return (
    <FieldFrame
      id={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(props.required === undefined ? {} : { required: props.required })}
      {...(requiredLabel === undefined ? {} : { requiredLabel })}
    >
      <input
        id={id}
        className={`input ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? `${id}-description` : undefined}
        {...props}
      />
    </FieldFrame>
  );
}

export function SelectField({
  label,
  hint,
  error,
  requiredLabel,
  id,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldBase & { id: string }) {
  return (
    <FieldFrame
      id={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(props.required === undefined ? {} : { required: props.required })}
      {...(requiredLabel === undefined ? {} : { requiredLabel })}
    >
      <select
        id={id}
        className={`select ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? `${id}-description` : undefined}
        {...props}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  requiredLabel,
  id,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldBase & { id: string }) {
  return (
    <FieldFrame
      id={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
      {...(props.required === undefined ? {} : { required: props.required })}
      {...(requiredLabel === undefined ? {} : { requiredLabel })}
    >
      <textarea
        id={id}
        className={`textarea ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? `${id}-description` : undefined}
        {...props}
      />
    </FieldFrame>
  );
}
