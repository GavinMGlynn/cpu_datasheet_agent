import type { ChangeEvent, ReactNode } from 'react';

/** The form controls, so every filter row looks and behaves the same. */

export interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly id?: string;
}

export function Select(props: SelectProps): ReactNode {
  const id = props.id ?? `select-${props.label.replace(/\s+/gu, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={props.value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          props.onChange(event.target.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly id?: string;
  readonly type?: 'text' | 'number';
  readonly multiline?: boolean;
}

export function TextField(props: TextFieldProps): ReactNode {
  const id = props.id ?? `field-${props.label.replace(/\s+/gu, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.multiline === true ? (
        <textarea
          id={id}
          value={props.value}
          rows={3}
          placeholder={props.placeholder ?? ''}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange(event.target.value);
          }}
        />
      ) : (
        <input
          id={id}
          type={props.type ?? 'text'}
          value={props.value}
          placeholder={props.placeholder ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </div>
  );
}

export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly id?: string;
}

export function Checkbox(props: CheckboxProps): ReactNode {
  const id = props.id ?? `check-${props.label.replace(/\s+/gu, '-')}`;
  // The box and its words sit on one line: a label above a lonely checkbox
  // reads as a heading for something else.
  return (
    <div className="field check">
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={props.checked}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            props.onChange(event.target.checked);
          }}
        />
        {props.label}
      </label>
    </div>
  );
}
