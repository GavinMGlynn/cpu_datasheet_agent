import type { ReactNode } from 'react';

import { useApp } from '../app.js';
import { Async } from '../components/Async.js';
import { Page } from '../components/Page.js';
import { Stat, Stats } from '../components/Stat.js';
import { bytes, count, when } from '../lib/format.js';
import { useAsync } from '../lib/state.js';

/**
 * Whether this installation is in a state to do any work.
 *
 * Credentials are reported as present or absent and never as values; the
 * server would not send one, and this would not show it.
 */

const LIMITATIONS: readonly { readonly id: string; readonly text: string }[] = Object.freeze([
  {
    id: 'L1',
    text: 'a derived value cannot be verified against a page: feedbackAccuracy is arithmetic on two stated limits, so the pass reads the page, finds no percentage, and says not found.',
  },
  {
    id: 'L2',
    text: 'reconciliation compares an operating-temperature maximum without comparing its reference: 125 °C junction and 85 °C ambient are both right, and the comparison calls it a conflict.',
  },
  {
    id: 'L3',
    text: '"what the page states" and "what applies to this orderable" are not the same claim, and the verification pass checks the first.',
  },
  {
    id: 'L4',
    text: 'a datasheet can contradict itself, and nothing here decides which half wins.',
  },
  {
    id: 'L5',
    text: 'an AEC-Q100 claim on page 1 and an ordering table that does not repeat it are not reconciled.',
  },
  {
    id: 'L6',
    text: 'the evaluation measures extraction against a reading by the same model family: it catches regressions and gross errors, not a misreading that comes from how the model reads.',
  },
  {
    id: 'L7',
    text: 'one datasheet page of text costs about a dollar to hold in context across a run, and the parameter set is written out twice.',
  },
]);

export function HealthPage(): ReactNode {
  const { api, source } = useApp();
  const health = useAsync(`health:${source}`, () => api.health(source));

  return (
    <Page title="health" subtitle="what this installation has, and what it is missing">
      <Async state={health.state} label="the health report">
        {(value) => (
          <>
            <Stats>
              <Stat label="version" value={value.version} note={when(value.now)} />
              <Stat
                label="database"
                value={count(value.database.totals.parts)}
                note={`${count(value.database.totals.parametersStated)} parameters, ${count(value.database.totals.datasheets)} datasheets`}
              />
              <Stat
                label="ledger"
                value={count(value.ledger.records)}
                note={
                  value.ledger.malformed === 0
                    ? 'every line readable'
                    : `${count(value.ledger.malformed)} lines unreadable`
                }
              />
              <Stat
                label="poppler"
                value={value.poppler.available ? 'installed' : 'missing'}
                note={
                  value.poppler.available
                    ? Object.entries(value.poppler.versions ?? {})
                        .map(([tool, version]) => `${tool} ${version}`)
                        .join(', ')
                    : 'datasheet pages cannot be read or rendered'
                }
              />
              <Stat
                label="source"
                value={value.source.label}
                note={`${bytes(value.source.bytes)}${value.source.writable ? '' : ', read only'}`}
              />
            </Stats>
            <div className="split">
              <div className="panel">
                <h3>credentials</h3>
                <table>
                  <tbody>
                    {Object.entries(value.credentials).map(([name, present]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>{present ? 'present' : 'not configured'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="caption" style={{ marginTop: 8 }}>
                  the server reports whether a credential is set and never what it is.
                </p>
              </div>
              <div className="panel">
                <h3>where things live</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>database</td>
                      <td className="mono">{value.database.file}</td>
                    </tr>
                    <tr>
                      <td>ledger</td>
                      <td className="mono">{value.ledger.dir}</td>
                    </tr>
                    <tr>
                      <td>cache</td>
                      <td className="mono">{value.cacheDir}</td>
                    </tr>
                    <tr>
                      <td>migrations</td>
                      <td>{value.database.migrations.join(', ')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>what this system does not do</h3>
              {LIMITATIONS.map((limitation) => (
                <p className="caption" key={limitation.id}>
                  <strong>{limitation.id}</strong> {limitation.text}
                </p>
              ))}
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}
