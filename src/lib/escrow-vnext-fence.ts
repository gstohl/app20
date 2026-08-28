/**
 * Returns the maker-selected monotonic fence that the final commitment binds.
 * The signed quote fence is only the lower bound established before selection.
 */
export function selectedReservationFence(
 input: Readonly<{
  quotedFence: bigint;
  selectedFence: bigint;
 }>,
): bigint {
 const maxU256 = (1n << 256n) - 1n;
 if (
  typeof input.quotedFence !== "bigint" ||
  typeof input.selectedFence !== "bigint"
 ) {
  throw new Error("Reservation fences must be bigint values.");
 }
 if (input.quotedFence <= 0n || input.selectedFence <= 0n) {
  throw new Error("Reservation fences must be greater than zero.");
 }
 if (input.quotedFence > maxU256 || input.selectedFence > maxU256) {
  throw new Error("Reservation fences must fit u256.");
 }
 if (input.selectedFence < input.quotedFence) {
  throw new Error("The selected reservation fence must not be stale.");
 }
 return input.selectedFence;
}
