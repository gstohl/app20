/**
 * Base units rendered for a person: the integer part grouped with literal
 * commas, the fraction never grouped. The separator is fixed rather than
 * locale-formatted so a decimal point cannot become a group mark elsewhere.
 */
export function humanUnits(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? value.toString() : digits.slice(0, -decimals);
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decimals === 0) return grouped;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${grouped}.${fraction}` : grouped;
}
