const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

/** 1234567 -> "1,234,567" */
export function commas(n: number): string {
  const whole = Math.floor(Math.abs(n)).toString()
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return n < 0 ? `-${grouped}` : grouped
}

/** A count and its noun: "1 stone", "1,200 stones". */
export function plural(n: number, one: string, many: string): string {
  return `${commas(n)} ${n === 1 ? one : many}`
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

/** A span of seconds in its largest unit: 45s, 12m, 3.5h, 13h, 2.5d. */
export function fmtSpan(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  const s = Math.max(1, Math.round(seconds))
  const one = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : commas(Math.round(n)))
  if (s < 60) return `${s}s`
  if (s < 3_600) return `${Math.round(s / 60)}m`
  if (s < 48 * 3_600) return `${one(s / 3_600)}h`
  return `${one(s / 86_400)}d`
}
