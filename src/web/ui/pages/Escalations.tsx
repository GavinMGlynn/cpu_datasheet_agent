import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Dialog } from '../components/Dialog.js';
import { Json } from '../components/Json.js';
import { Page } from '../components/Page.js';
import { Time } from '../components/Time.js';
import { Select, TextField } from '../components/Fields.js';
import { errorMessage } from '../lib/format.js';
import { useAsync } from '../lib/state.js';
import type { Escalation } from '../lib/types.js';

/**
 * The questions the agent refused to answer on its own.
 *
 * Escalating rather than guessing is one of this project's rules; this is
 * where the other half of that bargain gets kept.
 */

export function Escalations(): ReactNode {
  const { api, source } = useApp();
  const [filter, setFilter] = useState('open');
  const [answering, setAnswering] = useState<Escalation | undefined>(undefined);
  const [form, setForm] = useState({ answer: '', reason: '', actor: 'gavin' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const escalations = useAsync(`escalations:${source}:${filter}`, () =>
    api.escalations({
      source,
      ...(filter === 'all' ? {} : { resolved: filter === 'resolved' }),
    }),
  );

  const resolve = (escalation: Escalation): void => {
    setBusy(true);
    api
      .resolveEscalation(escalation.id, { ...form })
      .then(() => {
        setBusy(false);
        setAnswering(undefined);
        setForm({ answer: '', reason: '', actor: form.actor });
        escalations.reload();
      })
      .catch((error: unknown) => {
        setBusy(false);
        setFailure(errorMessage(error));
      });
  };

  return (
    <Page title="Questions" subtitle="What the agent handed to a person rather than guessing at">
      <div className="filters">
        <Select
          label="Show"
          value={filter}
          options={[
            { value: 'open', label: 'Still open' },
            { value: 'resolved', label: 'Answered' },
            { value: 'all', label: 'Everything' },
          ]}
          onChange={setFilter}
        />
      </div>
      <Async state={escalations.state} label="the questions">
        {(value) =>
          value.escalations.length === 0 ? (
            <p className="empty">Nothing is waiting on a person.</p>
          ) : (
            <div className="stack">
              {value.escalations.map((escalation) => (
                <div className="panel" key={escalation.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0 }}>{escalation.mpn}</h3>
                    <span className="badge">{escalation.kind.replace(/_/gu, ' ')}</span>
                  </div>
                  <p>{escalation.question}</p>
                  <Json value={escalation.context} label="What the run was looking at" />
                  {escalation.resolution === undefined ? (
                    <button
                      type="button"
                      className="action"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setAnswering(escalation);
                      }}
                    >
                      Answer
                    </button>
                  ) : (
                    <p className="caption">
                      answered by {escalation.resolution.by} on{' '}
                      <Time value={escalation.resolution.resolvedAt} />:{' '}
                      {escalation.resolution.answer}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )
        }
      </Async>
      {answering === undefined ? null : (
        <Dialog
          title={`Answer the question about ${answering.mpn}`}
          confirmLabel="Record answer"
          busy={busy}
          confirmDisabled={form.answer.trim() === '' || form.reason.trim().length < 3}
          onCancel={() => {
            setAnswering(undefined);
            setFailure(undefined);
          }}
          onConfirm={() => {
            resolve(answering);
          }}
        >
          <p>{answering.question}</p>
          {answering.options === undefined ? null : (
            <div className="row">
              {answering.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setForm({ ...form, answer: option });
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <TextField
            label="Your answer"
            value={form.answer}
            multiline
            onChange={(value) => {
              setForm({ ...form, answer: value });
            }}
          />
          <TextField
            label="Why you are answering it"
            value={form.reason}
            onChange={(value) => {
              setForm({ ...form, reason: value });
            }}
          />
          <TextField
            label="Your name"
            value={form.actor}
            onChange={(value) => {
              setForm({ ...form, actor: value });
            }}
          />
          {failure === undefined ? null : (
            <p className="danger" role="alert">
              {failure}
            </p>
          )}
        </Dialog>
      )}
    </Page>
  );
}
