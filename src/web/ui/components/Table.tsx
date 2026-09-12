import type { ReactNode } from 'react';
import { useState } from 'react';

/**
 * A table you can sort by clicking a heading.
 *
 * Sorting happens here rather than at the server for the tables that are
 * already on screen; the parts catalogue sorts server-side because it pages.
 * A column says which it is by giving a `sort` function or not.
 */

export interface Column<T> {
  readonly key: string;
  readonly label: string;
  readonly render: (row: T) => ReactNode;
  /** Present when the column can be sorted here. */
  readonly sort?: (row: T) => string | number | undefined;
  readonly numeric?: boolean;
}

export interface TableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly empty?: string;
  /** The column sorted on first load. */
  readonly initialSort?: string;
  readonly initialDirection?: 'asc' | 'desc';
}

export function Table<T>(props: TableProps<T>): ReactNode {
  const [sortKey, setSortKey] = useState(props.initialSort);
  const [direction, setDirection] = useState<'asc' | 'desc'>(props.initialDirection ?? 'asc');

  const column = props.columns.find((one) => one.key === sortKey);
  const rows =
    column?.sort === undefined
      ? props.rows
      : [...props.rows].sort((a, b) => {
          const left = column.sort?.(a);
          const right = column.sort?.(b);
          const sign = direction === 'asc' ? 1 : -1;
          if (left === undefined && right === undefined) {
            return 0;
          }
          if (left === undefined) {
            return 1;
          }
          if (right === undefined) {
            return -1;
          }
          return typeof left === 'string' || typeof right === 'string'
            ? sign * String(left).localeCompare(String(right))
            : sign * (left - right);
        });

  if (props.rows.length === 0) {
    return <p className="empty">{props.empty ?? 'nothing here'}</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          {props.columns.map((one) => (
            <th key={one.key} className={one.numeric === true ? 'numeric' : undefined}>
              {one.sort === undefined ? (
                one.label
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (sortKey === one.key) {
                      setDirection(direction === 'asc' ? 'desc' : 'asc');
                      return;
                    }
                    setSortKey(one.key);
                    setDirection('asc');
                  }}
                  aria-label={`sort by ${one.label}`}
                >
                  {one.label}
                  {sortKey === one.key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={props.rowKey(row)}>
            {props.columns.map((one) => (
              <td key={one.key} className={one.numeric === true ? 'numeric' : undefined}>
                {one.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
