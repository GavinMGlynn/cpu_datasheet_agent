import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Json } from '../components/Json.js';
import { Page } from '../components/Page.js';
import { Select } from '../components/Fields.js';
import { Table } from '../components/Table.js';
import { count, when } from '../lib/format.js';
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
      title="audit trail"
      subtitle="every change made by hand, with the reason given at the time"
    >
      <div className="filters">
        <Select
          label="what was changed"
          value={kind}
          options={[
            { value: '', label: 'anything' },
            { value: 'parameter', label: 'a parameter' },
            { value: 'part', label: 'a part' },
            { value: 'escalation', label: 'a question' },
            { value: 'golden', label: 'the golden set' },
            { value: 'cache', label: 'the cache' },
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
              empty="nothing has been changed by hand in this database"
              columns={[
                { key: 'at', label: 'when', render: (event) => when(event.at) },
                { key: 'actor', label: 'who', render: (event) => event.actor },
                { key: 'action', label: 'what', render: (event) => <code>{event.action}</code> },
                { key: 'target', label: 'to', render: (event) => event.targetId },
                { key: 'reason', label: 'why', render: (event) => event.reason },
                {
                  key: 'before',
                  label: 'was',
                  render: (event) =>
                    event.before === undefined ? '—' : <Json value={event.before} label="before" />,
                },
                {
                  key: 'after',
                  label: 'became',
                  render: (event) =>
                    event.after === undefined ? '—' : <Json value={event.after} label="after" />,
                },
              ]}
            />
          </div>
        )}
      </Async>
    </Page>
  );
}
