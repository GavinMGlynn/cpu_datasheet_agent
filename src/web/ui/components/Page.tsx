import type { ReactNode } from 'react';

export interface PageProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/** A page: a heading that says what you are looking at, and the thing itself. */
export function Page(props: PageProps): ReactNode {
  return (
    <>
      <header className="page-head">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle === undefined ? null : <p>{props.subtitle}</p>}
        </div>
        {props.actions === undefined ? null : <div className="row">{props.actions}</div>}
      </header>
      {props.children}
    </>
  );
}
