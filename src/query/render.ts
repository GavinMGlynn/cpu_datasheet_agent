import type { Alternate, AlternateResult, UnitPrice } from './types.js';

function price(price: UnitPrice | null): string {
  return price === null
    ? 'no price in this currency'
    : `${price.currency} ${price.amount.toFixed(2)} each at ${String(price.breakQuantity)}+ (${price.distributor} ${price.sku})`;
}

/** A saving as a person says it: a negative one is not a saving. */
function difference(saving: number): string {
  const percent = Math.abs(saving * 100).toFixed(0);
  return saving < 0 ? `${percent}% dearer` : `${percent}% cheaper`;
}

function differences(alternate: Alternate): string[] {
  return alternate.comparison
    .filter((one) => !one.same)
    .map(
      (one) => `${one.key}: ${JSON.stringify(one.reference)} → ${JSON.stringify(one.candidate)}`,
    );
}

/**
 * The answer as a person reads it, ending where every answer ends.
 *
 * The differences are listed rather than summarised: a part that meets the
 * constraints can still differ in a dozen ways that matter to the board it is
 * going on, and this is the list somebody has to read before believing the
 * price.
 */
export function renderAlternates(result: AlternateResult): string {
  const lines: string[] = [];
  lines.push(`${result.reference.mpn} — ${price(result.referencePrice)}`);
  lines.push('');
  if (result.alternates.length === 0) {
    lines.push('No stored part meets those constraints.');
  }
  result.alternates.forEach((alternate, index) => {
    const saving = alternate.saving === null ? '' : `  ${difference(alternate.saving)}`;
    lines.push(`${String(index + 1)}. ${alternate.part.mpn} — ${price(alternate.price)}${saving}`);
    lines.push(
      `   status ${alternate.part.status}, pin compatibility ${alternate.pinCompatibility}`,
    );
    for (const difference of differences(alternate)) {
      lines.push(`   ${difference}`);
    }
    lines.push('');
  });
  for (const one of result.excluded) {
    lines.push(`not offered: ${one.mpn} (${one.reason})`);
  }
  if (result.excluded.length > 0) {
    lines.push('');
  }
  lines.push(result.disclaimer);
  return lines.join('\n');
}
