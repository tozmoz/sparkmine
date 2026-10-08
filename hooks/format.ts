const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

/** 1234567 -> "1,234,567" */
export function commas(n: number): string {
  const whole = Math.floor(Math.abs(n)).toString()
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return n < 0 ? `-${grouped}` : grouped
}

/** Whole sparks: commas up to 99,999, then 123.4K, 1.23M and so on. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (Math.abs(n) < 100_000) return commas(n)
  let tier = Math.floor(Math.log10(Math.abs(n)) / 3)
  let scaled = n / 10 ** (tier * 3)
  let digits = scaled >= 100 ? 1 : 2
  if (Number(scaled.toFixed(digits)) >= 1000) {
    tier += 1
    scaled /= 1000
    digits = 2
  }
  const suffix = SUFFIXES[tier]
  if (suffix === undefined) return n.toExponential(2)
  return `${scaled.toFixed(digits)}${suffix}`
}

/** A per-second rate: one decimal while small. */
export function fmtRate(n: number): string {
  const tenths = Math.round(n * 10) / 10
  if (tenths < 10) return tenths.toFixed(1)
  return fmt(Math.round(n))
}
