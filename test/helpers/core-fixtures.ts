/**
 * Builders for valid core-schema values. Every builder returns a plain object
 * that the matching schema accepts unchanged; tests override single fields to
 * produce rejections. Return types are loose on purpose so tests can inject
 * invalid values.
 */
export type Loose = Record<string, unknown>;

export const SHA = 'a'.repeat(64);
export const OTHER_SHA = 'b'.repeat(64);
export const NOW = '2026-09-10T00:00:00Z';
export const LATER = '2026-09-10T01:00:00Z';
export const EARLIER = '2026-09-09T23:00:00Z';
export const UUID = '3f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
export const OTHER_UUID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
export const CACHE_KEY = 'c'.repeat(64);

export function q(value: number, unit: string): Loose {
  return { value, unit };
}

export function datasheetProvenance(page = 5, overrides: Loose = {}): Loose {
  return { source: 'datasheet', sha256: SHA, page, method: 'text', ...overrides };
}

export function distributorProvenance(overrides: Loose = {}): Loose {
  return {
    source: 'distributor',
    distributor: 'digikey',
    sku: '296-28446-1-ND',
    fetchedAt: NOW,
    cacheKey: CACHE_KEY,
    ...overrides,
  };
}

export function humanProvenance(overrides: Loose = {}): Loose {
  return { source: 'human', note: 'read from the ordering guide', recordedAt: NOW, ...overrides };
}

export function derivedProvenance(overrides: Loose = {}): Loose {
  return { source: 'derived', from: ['vinMin', 'vinMax'], rule: 'vin-class.v1', ...overrides };
}

/** A distributor value that disagrees with the one a parameter holds. */
export function conflict(overrides: Loose = {}): Loose {
  return {
    observed: { kind: 'quantity', value: q(36, 'V') },
    provenance: distributorProvenance(),
    rule: 'quantity-tolerance.v1',
    ...overrides,
  };
}

export function param(value: unknown, page = 5, confidence = 'extracted'): Loose {
  return { value, provenance: datasheetProvenance(page), confidence };
}

/** A non-synchronous, integrated-FET, adjustable 3 A buck (TPS54331-like). */
export function buckParameters(overrides: Loose = {}): Loose {
  return {
    vinMin: param(q(3.5, 'V'), 4),
    vinMax: param(q(28, 'V'), 4),
    vinAbsMax: param(q(30, 'V'), 3),
    voutMin: param(q(0.8, 'V'), 4),
    voutMax: param(q(25, 'V'), 4),
    voutFixed: param(null, 1),
    ioutMax: param(q(3, 'A'), 1),
    switchingFrequency: param(q(570000, 'Hz'), 5),
    feedbackReference: param(q(0.8, 'V'), 5),
    feedbackAccuracy: param(q(2, 'percent'), 5),
    quiescentCurrent: param(q(0.00007, 'A'), 5),
    shutdownCurrent: param(q(0.000001, 'A'), 5),
    topology: param('non_synchronous', 1),
    integration: param('integrated_fet', 1),
    softStart: param({ present: true, time: null }, 9),
    enablePin: param(true, 8),
    powerGoodPin: param(false, 8),
    lightLoadMode: param('none', 10),
    externalSync: param(false, 10),
    operatingTempMin: param(q(-40, 'degC'), 3),
    operatingTempMax: param(q(150, 'degC'), 3),
    temperatureReference: param('junction', 3),
    package: param('SOIC-8', 2),
    thermalPad: param(false, 2),
    minOnTime: param(q(0.00000013, 's'), 5),
    maxDutyCycle: param(q(91, 'percent'), 5),
    efficiencyPeak: param(q(90, 'percent'), 12),
    rdsOnHigh: param(q(0.08, 'Ohm'), 5),
    rdsOnLow: param(null, 5),
    aecQ100: param(false, 1),
    ...overrides,
  };
}

export function priceBreaks(): Loose[] {
  return [
    { quantity: 1, unitPrice: 2.31 },
    { quantity: 10, unitPrice: 1.98 },
    { quantity: 100, unitPrice: 1.42 },
  ];
}

export function offer(overrides: Loose = {}): Loose {
  return {
    distributor: 'digikey',
    sku: '296-28446-1-ND',
    manufacturer: 'Texas Instruments',
    mpnAsListed: 'TPS54331DR',
    currency: 'AUD',
    priceBreaks: priceBreaks(),
    stock: 12000,
    moq: 1,
    packaging: 'cut_tape',
    fetchedAt: NOW,
    provenance: distributorProvenance(),
    ...overrides,
  };
}

export function datasheet(overrides: Loose = {}): Loose {
  return {
    url: 'https://www.ti.com/lit/ds/symlink/tps54331.pdf',
    sha256: SHA,
    pageCount: 40,
    fetchedAt: NOW,
    localPath: '/data/cache/pdf/aa/aa/' + SHA,
    coversMpns: ['TPS54331D', 'TPS54331DR'],
    ...overrides,
  };
}

export function classification(overrides: Loose = {}): Loose {
  return {
    axis: 'vinClass',
    value: 'le_42v',
    derivedFrom: ['vinMax'],
    rule: 'vin-class.v1',
    ...overrides,
  };
}

export function escalation(overrides: Loose = {}): Loose {
  return {
    id: UUID,
    mpn: 'TPS54331DR',
    kind: 'conflict',
    question: 'Datasheet says Vin max 28 V, Digi-Key says 30 V. Which is correct?',
    context: { datasheet: 28, distributor: 30, page: 4 },
    createdAt: NOW,
    ...overrides,
  };
}

export function verification(overrides: Loose = {}): Loose {
  return {
    parameterKey: 'vinMax',
    verdict: 'confirmed',
    quote: 'Input voltage range 3.5 V to 28 V',
    page: 4,
    checkedAt: NOW,
    promptVersion: 'verify.v1',
    model: 'claude-opus-5',
    ...overrides,
  };
}

/** A verdict as a verification run states it, before the run names itself. */
export function verificationClaim(overrides: Loose = {}): Loose {
  const { checkedAt: _checkedAt, promptVersion: _prompt, model: _model, ...claim } = verification();
  return { ...claim, ...overrides };
}

export function runDetails(overrides: Loose = {}): Loose {
  return {
    subtype: 'success',
    toolCalls: 9,
    toolFailures: [],
    escalations: 0,
    spendDenials: 0,
    cacheMisses: 0,
    stored: true,
    ...overrides,
  };
}

/** A run that has started and not yet finished. */
export function run(overrides: Loose = {}): Loose {
  return {
    id: UUID,
    mpn: 'TPS54331DR',
    kind: 'extract',
    promptVersion: 'extract.v1',
    model: 'claude-opus-5',
    startedAt: NOW,
    ...overrides,
  };
}

/** The same run, ended. */
export function finishedRun(overrides: Loose = {}): Loose {
  return run({
    endedAt: LATER,
    turns: 12,
    costUsd: 0.42,
    result: 'extracted',
    details: runDetails(),
    ...overrides,
  });
}

export function toolCallRecord(overrides: Loose = {}): Loose {
  return {
    id: UUID,
    sessionId: 'session-1',
    tool: 'read_pages',
    input: { sha256: SHA, pages: [4, 5] },
    output: { pages: [{ page: 4, text: '...' }] },
    startedAt: NOW,
    durationMs: 120,
    spendsQuota: false,
    ...overrides,
  };
}

export function part(overrides: Loose = {}): Loose {
  return {
    mpn: 'TPS54331DR',
    manufacturer: 'Texas Instruments',
    category: 'buck_regulator',
    parameters: buckParameters(),
    datasheet: datasheet(),
    offers: [offer()],
    classifications: [classification()],
    verifications: [],
    status: 'extracted',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Every parameter re-wrapped with the given confidence. */
export function withConfidence(parameters: Loose, confidence: string): Loose {
  const out: Loose = {};
  for (const [key, value] of Object.entries(parameters)) {
    out[key] = { ...(value as Loose), confidence };
  }
  return out;
}
