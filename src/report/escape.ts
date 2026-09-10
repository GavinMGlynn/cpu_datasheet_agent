/**
 * Escapes text for both element content and quoted attribute values.
 *
 * Datasheet quotes and part numbers routinely contain `<`, `>`, `&`, and
 * quotes (`8-SOIC (0.154", 3.90mm Width)`), so every value interpolated into
 * the report goes through here.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, replacement);
}

/** Only ever called with the five characters the pattern above matches. */
function replacement(character: string): string {
  switch (character) {
    case '&':
      return '&amp;';
    case '<':
      return '&lt;';
    case '>':
      return '&gt;';
    case '"':
      return '&quot;';
    default:
      return '&#39;';
  }
}
