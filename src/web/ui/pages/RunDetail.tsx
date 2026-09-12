import type { ReactNode } from 'react';
import { useState } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Badge } from '../components/Badge.js';
import { Json } from '../components/Json.js';
import { Page } from '../components/Page.js';
import { Stat, Stats } from '../components/Stat.js';
import { duration, relative, shortId, usd } from '../lib/format.js';
import { label, labelOr } from '../lib/labels.js';
import { navigate } from '../lib/router.js';
import { useAsync } from '../lib/state.js';
import type { CallNode, ToolCall } from '../lib/types.js';

/**
 * One run, and every call it made.
 *
 * The tree is the point: a gate decision hangs under the call it gated, so
 * the shape shows which calls were questioned and which simply went through.
 */

function Node(props: {
  readonly node: CallNode;
  readonly depth: number;
  readonly onSelect: (call: ToolCall) => void;
}): ReactNode {
  const { node } = props;
  return (
    <li>
      <button
        type="button"
        className="link"
        onClick={() => {
          props.onSelect(node.record);
        }}
      >
        <span className="mono">{node.record.tool}</span>
      </button>{' '}
      <span className="caption">
        {duration(node.record.durationMs)}
        {node.record.spendsQuota ? ' · may spend' : ''}
        {node.record.error === undefined ? '' : ` · ${node.record.error.code}`}
      </span>
      {node.children.length === 0 ? null : (
        <ul>
          {node.children.map((child) => (
            <Node
              key={child.record.id}
              node={child}
              depth={props.depth + 1}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface RunDetailProps {
  readonly id: string;
}

export function RunDetail(props: RunDetailProps): ReactNode {
  const { api, source } = useApp();
  const [selected, setSelected] = useState<ToolCall | undefined>(undefined);
  const run = useAsync(`run:${source}:${props.id}`, () => api.run(props.id, source));

  return (
    <Page
      title={`Run ${shortId(props.id)}`}
      subtitle="What this run did, call by call"
      actions={
        <button
          type="button"
          className="secondary"
          onClick={() => {
            navigate('/runs');
          }}
        >
          Back to runs
        </button>
      }
    >
      <Async state={run.state} label="the run">
        {(value) => (
          <>
            <Stats>
              <Stat label="Part" value={value.run.mpn} note={label(value.run.kind)} />
              <Stat
                label="Cost"
                value={usd(value.run.costUsd)}
                note={`${String(value.run.turns ?? 0)} turns`}
              />
              <Stat
                label="Ended"
                value={labelOr(value.run.result, 'Unfinished')}
                note={value.run.details?.reason ?? value.run.details?.subtype ?? ''}
              />
              <Stat
                label="Tool calls"
                value={String(value.calls.length)}
                note={`${String(value.run.details?.toolFailures.length ?? 0)} failed`}
              />
              <Stat
                label="Took"
                value={
                  value.run.endedAt === undefined
                    ? '—'
                    : duration(Date.parse(value.run.endedAt) - Date.parse(value.run.startedAt))
                }
                note={relative(value.run.startedAt)}
              />
            </Stats>
            <div className="row" style={{ marginBottom: 12 }}>
              <Badge kind="runResult" value={value.run.result ?? 'unfinished'} />
              <span className="badge">{value.run.model}</span>
              <span className="badge">{value.run.promptVersion}</span>
              {value.run.details?.spendDenials === undefined ||
              value.run.details.spendDenials === 0 ? null : (
                <span className="badge">
                  {value.run.details.spendDenials} calls the money gate refused
                </span>
              )}
              {value.run.details?.cacheMisses === undefined ||
              value.run.details.cacheMisses === 0 ? null : (
                <span className="badge">
                  {value.run.details.cacheMisses} wanted something uncached
                </span>
              )}
            </div>
            <div className="split">
              <div className="panel">
                <h3>What it called</h3>
                {value.calls.length === 0 ? (
                  <p className="empty">
                    this run left no trace in the ledger — it may predate it, or the ledger may have
                    been cleared.
                  </p>
                ) : (
                  <ul>
                    {(value.tree as readonly CallNode[]).map((node) => (
                      <Node key={node.record.id} node={node} depth={0} onSelect={setSelected} />
                    ))}
                  </ul>
                )}
              </div>
              <div className="panel">
                <h3>{selected === undefined ? 'Pick a call' : selected.tool}</h3>
                {selected === undefined ? (
                  <p className="caption">
                    every call it made, with what went in and what came back.
                  </p>
                ) : (
                  <>
                    <Json value={selected.input} label="What went in" />
                    <p className="caption" style={{ marginTop: 8 }}>
                      {selected.error === undefined ? 'What came back' : 'What went wrong'}
                    </p>
                    <Json value={selected.error ?? selected.output} label="What came back" />
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}
