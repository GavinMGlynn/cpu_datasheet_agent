/**
 * Recursively freezes an object graph in place and returns it.
 *
 * Primitives and `null` are returned unchanged. Arrays and nested objects are
 * frozen. Cycles are not expected in the inputs this project freezes
 * (configuration and schema output) and are not handled.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
