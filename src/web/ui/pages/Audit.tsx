import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Json } from '../components/Json.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Select } from '../components/Fields.js';
import { Table } from '../components/Table.js';
import { count } from '../lib/format.js';
import { navigate, withQuery } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { AuditEvent } from '../lib/types.js';

/**
 * Every change a person made, and what it replaced.
 *
 * The ledger records what the agent did; this records what we did. Neither is
 * reconstructable afterwards, which is why both are written at the time.
 */

export function Audit(): ReactNode {
  const { api, source, route } = useApp();
  const kind = route.query.get('targetKind') ?? '';
  const events = useAsync(`audit:${source}:${kind}`, () =>
    api.audit({ source, limit: 200, ...(kind === '' ? {} : { targetKind: kind }) }),
  );

  return (
    <Page
      title="Audit trail"
      subtitle="Every change made by hand, with the reason given at the time"
    >
      <div className="filters">
        <Select
          label="What was changed"
          value={kind}
          options={[
            { value: '', label: 'Anything' },
            { value: 'parameter', label: 'A parameter' },
            { value: 'part', label: 'A part' },
            { value: 'escalation', label: 'A question' },
            { value: 'golden', label: 'The golden set' },
            { value: 'cache', label: 'The cache' },
          ]}
          onChange={(value) => {
            navigate(withQuery(route, { targetKind: value }));
          }}
        />
      </div>
      <Async state={events.state} label="the audit trail">
        {(page) => (
          <div className="panel">
            <p className="caption">{count(page.total)} changes</p>
            <Table<AuditEvent>
              rows={page.items}
              rowKey={(event) => event.id}
              empty="Nothing has been changed by hand in this database."
              columns={[
                { key: 'at', label: 'When', render: (event) => <Time value={event.at} /> },
                { key: 'actor', label: 'Who', render: (event) => event.actor },
                { key: 'action', label: 'What', render: (event) => <code>{event.action}</code> },
                { key: 'target', label: 'To', render: (event) => event.targetId },
                { key: 'reason', label: 'Why', render: (event) => event.reason },
                {
                  key: 'before',
                  label: 'Was',
                  render: (event) =>
                    event.before === undefined ? '—' : <Json value={event.before} label="Before" />,
                },
                {
                  key: 'after',
                  label: 'Became',
                  render: (event) =>
                    event.after === undefined ? '—' : <Json value={event.after} label="After" />,
                },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
