/** "C9H8O4" のようなHill記法の分子式文字列を元素ごとの個数に分解する */
export function parseFormula(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    const element = m[1];
    if (!element) continue;
    const count = m[2] ? parseInt(m[2], 10) : 1;
    counts[element] = (counts[element] ?? 0) + count;
  }
  return counts;
}
