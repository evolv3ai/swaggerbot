/**
 * A size in decimal units, as the viewer shows it: `6.4 MB`, `812 kB`,
 * `320 B`. The number and the unit apart, since they are set in different
 * faces.
 */
export function sizeOf(bytes: number): { value: string; unit: string } {
  if (bytes >= 1_000_000)
    return { value: (bytes / 1_000_000).toFixed(1), unit: "MB" };
  if (bytes >= 1_000)
    return { value: Math.round(bytes / 1_000).toString(), unit: "kB" };
  return { value: bytes.toString(), unit: "B" };
}
