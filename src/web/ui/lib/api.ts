import type {
  AuditEvent,
  CoverageCell,
  DataSource,
  Distribution,
  ErrorStat,
  Escalation,
  EvalListing,
  Health,
  Launch,
  Page,
  ParameterRow,
  ParameterScoreRow,
  PartSummary,
  Run,
  SpendBreakdown,
  SpendPoint,
  ToolCall,
  ToolStat,
} from './types.js';

/**
 * The one place the browser talks to the server.
 *
 * Every call carries the session cookie, and every state-changing call
 * repeats the token in a header, because a cookie alone is refused (D67).
 * Errors arrive as the server's envelope and are thrown as `ApiError`, so a
 * page can show the code rather than "something went wrong".
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /**
   * Repeated in a header on every write. Read from the readable session
   * cookie when not given, which is how the page gets it: the session cookie
   * itself is HttpOnly and deliberately out of reach.
   */
  readonly token?: string;
  /** Where the token is read from. Defaults to the document's cookies. */
  readonly cookies?: () => string;
}

/** The readable half of the session pair, as the server sets it. */
export const CSRF_COOKIE = 'chip_csrf';

export function tokenFromCookies(cookies: string): string | undefined {
  for (const part of cookies.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      continue;
    }
    if (part.slice(0, index).trim() === CSRF_COOKIE) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

interface ErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly details?: unknown;
  };
}

function query(params: Readonly<Record<string, string | number | boolean | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export interface PartQuery {
  readonly source?: string;
  readonly status?: string;
  readonly manufacturer?: string;
  readonly text?: string;
  readonly sort?: string;
  readonly direction?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly quantity?: number;
  readonly currency?: string;
}

export interface LedgerQuery {
  readonly sessionId?: string;
  readonly tool?: string;
  readonly failed?: boolean;
  readonly spendsQuota?: boolean;
  readonly text?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SignedInAccount {
  readonly username: string;
  readonly displayName: string;
  readonly role: 'viewer' | 'admin';
}

export interface AuthState {
  /** How many accounts exist at all: none means nobody can sign in yet. */
  readonly accounts: number;
  readonly oidc: boolean;
  readonly oidcLabel: string | null;
  readonly signedInAs: SignedInAccount | null;
}

export interface Api {
  authState(): Promise<AuthState>;
  signIn(username: string, password: string): Promise<{ readonly account: SignedInAccount }>;
  signOut(): Promise<unknown>;
  signOutEverywhere(): Promise<unknown>;
  changePassword(current: string, next: string): Promise<unknown>;
  sources(): Promise<{ sources: readonly DataSource[] }>;
  health(source: string): Promise<Health>;
  meta(): Promise<{
    readonly parameterKeys: readonly string[];
    readonly classificationAxes: readonly string[];
    readonly partStatuses: readonly string[];
    readonly prompts: readonly string[];
    readonly model: string;
    readonly version: string;
  }>;
  parts(options: PartQuery): Promise<Page<PartSummary> & { readonly source: string }>;
  part(
    mpn: string,
    options: { readonly source?: string; readonly quantity?: number },
  ): Promise<{
    readonly part: unknown;
    readonly summary: PartSummary;
    readonly parameters: readonly ParameterRow[];
    readonly runs: readonly Run[];
    readonly escalations: readonly Escalation[];
    readonly datasheetMpns: readonly string[];
  }>;
  coverage(source: string): Promise<{ readonly coverage: readonly CoverageCell[] }>;
  datasheets(source: string): Promise<{
    readonly datasheets: readonly {
      readonly sha256: string;
      readonly url: string;
      readonly pageCount: number;
      readonly fetchedAt: string;
      readonly parts: readonly string[];
    }[];
  }>;
  verifications(
    mpn: string,
    source: string,
  ): Promise<{
    readonly counts: Readonly<Record<string, number>>;
    readonly verifications: readonly unknown[];
  }>;
  distribution(key: string, source: string, buckets?: number): Promise<Distribution>;
  compare(
    mpns: readonly string[],
    source: string,
  ): Promise<{
    readonly parts: readonly {
      readonly summary: PartSummary;
      readonly parameters: readonly ParameterRow[];
    }[];
    readonly keys: readonly string[];
  }>;
  alternates(
    body: Readonly<Record<string, unknown>>,
    source: string,
  ): Promise<{ readonly result: unknown }>;
  runs(options: {
    readonly source?: string;
    readonly kind?: string;
    readonly result?: string;
    readonly mpn?: string;
    readonly limit?: number;
  }): Promise<Page<Run>>;
  run(
    id: string,
    source: string,
  ): Promise<{ readonly run: Run; readonly calls: readonly ToolCall[]; readonly tree: unknown }>;
  ledger(options: LedgerQuery): Promise<Page<ToolCall>>;
  ledgerCall(
    id: string,
  ): Promise<{ readonly record: ToolCall; readonly children: readonly ToolCall[] }>;
  overview(source: string): Promise<Readonly<Record<string, unknown>>>;
  spend(source: string, granularity: string): Promise<{ readonly points: readonly SpendPoint[] }>;
  spendBy(
    dimension: string,
    source: string,
  ): Promise<{ readonly breakdown: readonly SpendBreakdown[] }>;
  tools(): Promise<{ readonly tools: readonly ToolStat[] }>;
  errors(): Promise<{ readonly errors: readonly ErrorStat[] }>;
  evals(): Promise<{ readonly results: readonly EvalListing[] }>;
  evalReport(id: string): Promise<{ readonly report: Readonly<Record<string, unknown>> }>;
  evalParameters(id: string): Promise<{ readonly parameters: readonly ParameterScoreRow[] }>;
  evalFailures(
    id: string,
  ): Promise<{ readonly failures: readonly Readonly<Record<string, unknown>>[] }>;
  evalCompare(
    from: string,
    to: string,
  ): Promise<{ readonly comparison: Readonly<Record<string, unknown>> }>;
  golden(): Promise<{ readonly parts: readonly Readonly<Record<string, unknown>>[] }>;
  goldenHealth(): Promise<Readonly<Record<string, unknown>>>;
  escalations(options: {
    readonly source?: string;
    readonly resolved?: boolean;
  }): Promise<{ readonly escalations: readonly Escalation[] }>;
  resolveEscalation(
    id: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
  correctParameter(
    mpn: string,
    key: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
  setStatus(
    mpn: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
  audit(options: {
    readonly source?: string;
    readonly targetKind?: string;
    readonly limit?: number;
  }): Promise<Page<AuditEvent>>;
  cache(): Promise<Readonly<Record<string, unknown>>>;
  launches(): Promise<{ readonly launches: readonly Launch[] }>;
  launch(id: string): Promise<Launch>;
  estimate(kind: string, parts: number, source: string): Promise<Readonly<Record<string, unknown>>>;
  startLaunch(body: Readonly<Record<string, unknown>>): Promise<{ readonly launch: Launch }>;
  cancelLaunch(id: string): Promise<{ readonly launch: Launch }>;
  /** The URL of a rendered datasheet page, for an <img>. */
  pageImageUrl(sha256: string, page: number, source: string): string;
}

export function createApi(options: ApiOptions = {}): Api {
  const baseUrl = options.baseUrl ?? '';
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const cookies = options.cookies ?? ((): string => globalThis.document.cookie);
  // Read per call rather than once: a page that has just signed in must be
  // able to write without a reload.
  const token = (): string | undefined => options.token ?? tokenFromCookies(cookies());

  const call = async <T>(
    path: string,
    init: RequestInit & { readonly writes?: boolean } = {},
  ): Promise<T> => {
    const { writes, ...rest } = init;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (rest.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const repeated = writes === true ? token() : undefined;
    if (repeated !== undefined) {
      headers['x-chip-token'] = repeated;
    }
    const response = await doFetch(`${baseUrl}${path}`, {
      credentials: 'same-origin',
      ...rest,
      headers: { ...headers, ...(rest.headers as Record<string, string> | undefined) },
    });
    const text = await response.text();
    const body: unknown = text === '' ? null : JSON.parse(text);
    if (!response.ok) {
      const envelope = body as ErrorBody;
      throw new ApiError(
        response.status,
        envelope.error?.code ?? 'UNKNOWN',
        envelope.error?.message ?? `request failed with ${String(response.status)}`,
        envelope.error?.details,
      );
    }
    return body as T;
  };

  const post = <T>(path: string, body: unknown): Promise<T> =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body), writes: true });

  return {
    authState: () => call('/api/auth/state'),
    // The one call that goes out with no session: everything else needs one.
    signIn: (username, password) =>
      call('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    signOut: () => post('/api/auth/logout', {}),
    signOutEverywhere: () => post('/api/auth/logout-everywhere', {}),
    changePassword: (current, next) => post('/api/auth/password', { current, next }),
    sources: () => call('/api/sources'),
    health: (source) => call(`/api/health${query({ source })}`),
    meta: () => call('/api/meta'),
    parts: (options_) => call(`/api/parts${query({ ...options_ })}`),
    part: (mpn, options_) => call(`/api/parts/${encodeURIComponent(mpn)}${query({ ...options_ })}`),
    coverage: (source) => call(`/api/catalog/coverage${query({ source })}`),
    datasheets: (source) => call(`/api/datasheets${query({ source })}`),
    verifications: (mpn, source) =>
      call(`/api/parts/${encodeURIComponent(mpn)}/verifications${query({ source })}`),
    distribution: (key, source, buckets) =>
      call(`/api/catalog/distribution/${encodeURIComponent(key)}${query({ source, buckets })}`),
    compare: (mpns, source) =>
      call(`/api/catalog/compare${query({ mpns: mpns.join(','), source })}`),
    alternates: (body, source) => post(`/api/alternates${query({ source })}`, body),
    runs: (options_) => call(`/api/runs${query({ ...options_ })}`),
    run: (id, source) => call(`/api/runs/${encodeURIComponent(id)}${query({ source })}`),
    ledger: (options_) => call(`/api/ledger${query({ ...options_ })}`),
    ledgerCall: (id) => call(`/api/ledger/${encodeURIComponent(id)}`),
    overview: (source) => call(`/api/stats/overview${query({ source })}`),
    spend: (source, granularity) => call(`/api/stats/spend${query({ source, granularity })}`),
    spendBy: (dimension, source) =>
      call(`/api/stats/spend/${encodeURIComponent(dimension)}${query({ source })}`),
    tools: () => call('/api/stats/tools'),
    errors: () => call('/api/stats/errors'),
    evals: () => call('/api/evals'),
    evalReport: (id) => call(`/api/evals/${encodeURIComponent(id)}`),
    evalParameters: (id) => call(`/api/evals/${encodeURIComponent(id)}/parameters`),
    evalFailures: (id) => call(`/api/evals/${encodeURIComponent(id)}/failures`),
    evalCompare: (from, to) => call(`/api/evals/compare${query({ from, to })}`),
    golden: () => call('/api/golden'),
    goldenHealth: () => call('/api/golden/health'),
    escalations: (options_) => call(`/api/escalations${query({ ...options_ })}`),
    resolveEscalation: (id, body) =>
      post(`/api/escalations/${encodeURIComponent(id)}/resolve`, body),
    correctParameter: (mpn, key, body) =>
      post(`/api/parts/${encodeURIComponent(mpn)}/parameters/${encodeURIComponent(key)}`, body),
    setStatus: (mpn, body) => post(`/api/parts/${encodeURIComponent(mpn)}/status`, body),
    audit: (options_) => call(`/api/audit${query({ ...options_ })}`),
    cache: () => call('/api/cache'),
    launches: () => call('/api/launches'),
    launch: (id) => call(`/api/launches/${encodeURIComponent(id)}`),
    estimate: (kind, parts, source) =>
      call(`/api/launches/estimate${query({ kind, parts, source })}`),
    startLaunch: (body) => post('/api/launches', body),
    cancelLaunch: (id) => post(`/api/launches/${encodeURIComponent(id)}/cancel`, {}),
    pageImageUrl: (sha256, page, source) =>
      `${baseUrl}/api/datasheets/${sha256}/pages/${String(page)}/image${query({ source })}`,
  };
}
