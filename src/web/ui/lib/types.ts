/**
 * What the API sends, as the front end reads it.
 *
 * Structural rather than imported from the server modules: the browser
 * receives JSON, and a type that claimed more than JSON can carry — a class,
 * a Date, a schema brand — would be a claim the wire cannot keep.
 */

export interface Page<T> {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly items: readonly T[];
}

export interface UnitPrice {
  readonly amount: number;
  readonly currency: string;
  readonly breakQuantity: number;
  readonly distributor: string;
  readonly sku: string;
  readonly stock: number;
}

export interface ParameterCounts {
  readonly stated: number;
  readonly cited: number;
  readonly verified: number;
  readonly conflicted: number;
  readonly total: number;
}

export interface VerdictCounts {
  readonly confirmed: number;
  readonly contradicted: number;
  readonly notFound: number;
  readonly unchecked: number;
}

export interface PartSummary {
  readonly mpn: string;
  readonly manufacturer: string;
  readonly category: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly datasheet?: {
    readonly sha256: string;
    readonly url: string;
    readonly pageCount: number;
  };
  readonly parameters: ParameterCounts;
  readonly verdicts: VerdictCounts;
  readonly classifications: Readonly<Record<string, unknown>>;
  readonly offerCount: number;
  readonly distributors: readonly string[];
  readonly stock: number;
  readonly bestPrice: UnitPrice | null;
  readonly headline: Readonly<Record<string, unknown>>;
}

export interface Provenance {
  readonly source: 'datasheet' | 'distributor' | 'human' | 'derived';
  readonly page?: number;
  readonly sha256?: string;
  readonly quote?: string;
  readonly note?: string;
  readonly distributor?: string;
  readonly rule?: string;
  readonly from?: readonly string[];
}

export interface Verdict {
  readonly parameterKey: string;
  readonly verdict: 'confirmed' | 'contradicted' | 'not_found';
  readonly quote?: string;
  readonly page: number;
  readonly checkedAt: string;
  readonly model: string;
}

export interface ParameterRow {
  readonly key: string;
  readonly value: unknown;
  readonly confidence: string;
  readonly provenance: Provenance;
  readonly conflicts?: readonly unknown[];
  readonly verdict?: Verdict;
}

export interface RunDetails {
  readonly toolCalls: number;
  readonly toolFailures: readonly string[];
  readonly escalations: number;
  readonly spendDenials: number;
  readonly cacheMisses: number;
  readonly stored: boolean;
  readonly subtype: string;
  readonly reason?: string;
}

export interface Run {
  readonly id: string;
  readonly mpn: string;
  readonly kind: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly sessionId?: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly turns?: number;
  readonly costUsd?: number;
  readonly result?: string;
  readonly details?: RunDetails;
}

export interface ToolCall {
  readonly id: string;
  readonly sessionId: string;
  readonly parentId?: string;
  readonly tool: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string; readonly name: string };
  readonly startedAt: string;
  readonly durationMs: number;
  readonly spendsQuota: boolean;
}

export interface CallNode {
  readonly record: ToolCall;
  readonly children: readonly CallNode[];
}

export interface Summary {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
}

export interface SpendPoint {
  readonly key: string;
  readonly runs: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly cumulativeUsd: number;
}

export interface SpendBreakdown {
  readonly key: string;
  readonly runs: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly meanCostUsd: number;
  readonly unsuccessful: number;
}

export interface ToolStat {
  readonly tool: string;
  readonly calls: number;
  readonly failures: number;
  readonly failureRate: number;
  readonly spending: number;
  readonly duration: Summary;
  readonly totalMs: number;
  readonly errors: Readonly<Record<string, number>>;
}

export interface ErrorStat {
  readonly code: string;
  readonly count: number;
  readonly tools: readonly string[];
  readonly latestAt: string;
  readonly message: string;
}

export interface CoverageCell {
  readonly key: string;
  readonly stated: number;
  readonly cited: number;
  readonly verified: number;
  readonly conflicted: number;
  readonly contradicted: number;
  readonly parts: number;
  readonly coverage: number;
}

export interface Bucket {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export interface Distribution {
  readonly key: string;
  readonly unit?: string;
  readonly points: readonly {
    readonly mpn: string;
    readonly min?: number;
    readonly max?: number;
  }[];
  readonly summary?: Summary;
  readonly buckets: readonly Bucket[];
  readonly nonNumeric: number;
}

export interface DataSource {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly exists: boolean;
  readonly writable: boolean;
  readonly bytes: number;
  readonly modifiedAt?: string;
}

export interface LaunchEvent {
  readonly sequence: number;
  readonly at: string;
  readonly kind: string;
  readonly data: unknown;
}

export interface Launch {
  readonly id: string;
  readonly kind: string;
  readonly mpns: readonly string[];
  readonly model: string;
  readonly promptVersion: string;
  readonly maxCostUsd: number;
  readonly allowSpend: boolean;
  readonly actor: string;
  readonly startedAt: string;
  readonly state: 'running' | 'finished' | 'failed' | 'cancelled';
  readonly endedAt?: string;
  readonly runs: readonly Run[];
  readonly error?: string;
  readonly events?: readonly LaunchEvent[];
  readonly cancelling: boolean;
}

export interface AuditEvent {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly reason: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface Escalation {
  readonly id: string;
  readonly mpn: string;
  readonly kind: string;
  readonly question: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly options?: readonly string[];
  readonly createdAt: string;
  readonly resolution?: {
    readonly answer: string;
    readonly resolvedAt: string;
    readonly by: string;
  };
}

export interface EvalListing {
  readonly id: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly startedAt: string;
  readonly parts: number;
  readonly recall: number;
  readonly precision: number;
  readonly provenanceAccuracy: number;
  readonly withinOnePage: number;
  readonly costUsd: number;
  readonly turns: number;
  readonly starved: number;
}

export interface ParameterScoreRow {
  readonly key: string;
  readonly correct: number;
  readonly stated: number;
  readonly accuracy: number;
  readonly wrongParts: readonly string[];
  readonly missingParts: readonly string[];
  readonly citationExact: number;
  readonly citationWithinOne: number;
}

export interface Health {
  readonly version: string;
  readonly now: string;
  readonly source: DataSource;
  readonly credentials: Readonly<Record<string, boolean>>;
  readonly poppler: { readonly available: boolean; readonly versions?: Record<string, string> };
  readonly database: {
    readonly file: string;
    readonly migrations: readonly string[];
    readonly totals: {
      readonly parts: number;
      readonly parametersStated: number;
      readonly parametersCited: number;
      readonly offers: number;
      readonly datasheets: number;
      readonly byStatus: Readonly<Record<string, number>>;
      readonly byManufacturer: Readonly<Record<string, number>>;
    };
  };
  readonly ledger: {
    readonly dir: string;
    readonly records: number;
    readonly malformed: number;
    readonly firstAt?: string;
    readonly lastAt?: string;
  };
  readonly cacheDir: string;
}
