/**
 * A felt shortened for a row or a heading: at full length it wraps to two or
 * three lines and says nothing at a glance that the first and last bytes do
 * not. The full value stays available on hover and in the record itself.
 */
export function shortenFelt(value: string): string {
  const felt = value.trim();
  if (felt.length <= 18) return felt;
  return `${felt.slice(0, 10)}…${felt.slice(-6)}`;
}
