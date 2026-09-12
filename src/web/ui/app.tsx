import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { createApi, type Api } from './lib/api.js';
import { navigate, useRoute, withQuery, type Route } from './lib/router.js';
import { useAsync, useStored } from './lib/state.js';
import { Async } from './components/Async.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Alternates } from './pages/Alternates.js';
import { Audit } from './pages/Audit.js';
import { Compare } from './pages/Compare.js';
import { Control } from './pages/Control.js';
import { Costs } from './pages/Costs.js';
import { Datasheets } from './pages/Datasheets.js';
import { Escalations } from './pages/Escalations.js';
import { EvalDetail } from './pages/EvalDetail.js';
import { Evals } from './pages/Evals.js';
import { Golden } from './pages/Golden.js';
import { HealthPage } from './pages/Health.js';
import { Ledger } from './pages/Ledger.js';
import { Overview } from './pages/Overview.js';
import { Parameters } from './pages/Parameters.js';
import { PartDetail } from './pages/PartDetail.js';
import { Parts } from './pages/Parts.js';
import { Pricing } from './pages/Pricing.js';
import { RunDetail } from './pages/RunDetail.js';
import { Runs } from './pages/Runs.js';
import { Tools } from './pages/Tools.js';
import { Verification } from './pages/Verification.js';

/**
 * The application shell: which database is being read, which page is showing,
 * and the one API client everything shares.
 */

export interface AppContextValue {
  readonly api: Api;
  readonly source: string;
  readonly route: Route;
  setSource(source: string): void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === undefined) {
    throw new Error('a page was rendered outside the application');
  }
  return value;
}

export interface NavEntry {
  readonly path: string;
  readonly label: string;
  readonly group: string;
}

export const NAVIGATION: readonly NavEntry[] = Object.freeze([
  { path: '/', label: 'overview', group: 'the parts' },
  { path: '/parts', label: 'catalogue', group: 'the parts' },
  { path: '/parameters', label: 'parameters', group: 'the parts' },
  { path: '/compare', label: 'compare', group: 'the parts' },
  { path: '/alternates', label: 'alternates', group: 'the parts' },
  { path: '/pricing', label: 'pricing', group: 'the parts' },
  { path: '/datasheets', label: 'datasheets', group: 'the parts' },
  { path: '/escalations', label: 'questions', group: 'the parts' },
  { path: '/runs', label: 'runs', group: 'the agent' },
  { path: '/costs', label: 'cost', group: 'the agent' },
  { path: '/tools', label: 'tools', group: 'the agent' },
  { path: '/ledger', label: 'ledger', group: 'the agent' },
  { path: '/evals', label: 'evaluations', group: 'the agent' },
  { path: '/verification', label: 'verification', group: 'the agent' },
  { path: '/golden', label: 'golden set', group: 'the agent' },
  { path: '/control', label: 'run control', group: 'this machine' },
  { path: '/audit', label: 'audit trail', group: 'this machine' },
  { path: '/health', label: 'health', group: 'this machine' },
]);

function render(route: Route): ReactNode {
  const [first, second] = route.segments;
  if (first === undefined) {
    return <Overview />;
  }
  switch (first) {
    case 'parts':
      return second === undefined ? <Parts /> : <PartDetail mpn={second} />;
    case 'parameters':
      return <Parameters />;
    case 'compare':
      return <Compare />;
    case 'alternates':
      return <Alternates />;
    case 'pricing':
      return <Pricing />;
    case 'datasheets':
      return <Datasheets />;
    case 'escalations':
      return <Escalations />;
    case 'runs':
      return second === undefined ? <Runs /> : <RunDetail id={second} />;
    case 'costs':
      return <Costs />;
    case 'tools':
      return <Tools />;
    case 'ledger':
      return <Ledger />;
    case 'evals':
      return second === undefined ? <Evals /> : <EvalDetail id={second} />;
    case 'verification':
      return <Verification />;
    case 'golden':
      return <Golden />;
    case 'control':
      return <Control />;
    case 'audit':
      return <Audit />;
    case 'health':
      return <HealthPage />;
    default:
      return (
        <div className="failed" role="alert">
          there is no page at <code>{route.path}</code>.
        </div>
      );
  }
}

export interface AppProps {
  /** Injected by the tests; the browser uses the real one. */
  readonly api?: Api;
}

export function App(props: AppProps): ReactNode {
  const route = useRoute();
  const [stored, setSource] = useStored('chip:source', 'live');
  // An address that names a database wins over the remembered one, and is
  // remembered in turn: every endpoint takes `?source=`, so a link to a part
  // in an evaluation run has to open that run's copy rather than whichever
  // database this browser last looked at.
  const asked = route.query.get('source');
  const source = asked ?? stored;
  useEffect(() => {
    if (asked !== null && asked !== stored) {
      setSource(asked);
    }
  }, [asked, stored, setSource]);
  const api = useMemo(() => props.api ?? createApi(), [props.api]);
  const sources = useAsync('sources', () => api.sources());
  const meta = useAsync('meta', () => api.meta());
  const context = useMemo<AppContextValue>(
    () => ({ api, source, route, setSource }),
    [api, source, route, setSource],
  );

  return (
    <AppContext.Provider value={context}>
      <div className="app">
        <aside className="sidebar">
          <h1>chip datasheet agent</h1>
          <p className="version">
            <Async state={meta.state} label="version">
              {(value) => <>version {value.version}</>}
            </Async>
          </p>
          <div className="field">
            <label htmlFor="source">database</label>
            <Async state={sources.state} label="databases">
              {(value) => (
                <select
                  id="source"
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                  }}
                >
                  {value.sources.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.label}
                    </option>
                  ))}
                </select>
              )}
            </Async>
          </div>
          {[...new Set(NAVIGATION.map((entry) => entry.group))].map((group) => (
            <nav key={group} aria-label={group}>
              <p className="group">{group}</p>
              {NAVIGATION.filter((entry) => entry.group === group).map((entry) => (
                <a
                  key={entry.path}
                  href={entry.path}
                  aria-current={route.path === entry.path ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(withQuery({ ...route, path: entry.path }, {}));
                  }}
                >
                  {entry.label}
                </a>
              ))}
            </nav>
          ))}
        </aside>
        <main>
          {/* Keyed by the path: navigating away from a page that broke gives
              the next one a clean slate. */}
          <ErrorBoundary resetKey={route.path}>{render(route)}</ErrorBoundary>
        </main>
      </div>
    </AppContext.Provider>
  );
}
