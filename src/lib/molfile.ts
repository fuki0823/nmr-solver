/**
 * 最小限のMDL Molfile (V2000) パーサー。
 *
 * ketcher-core の MolSerializer は使わない: `ketcher-core` からの値import(バレル経由)は
 * `paper`(canvasレンダリング用の依存、Node/jsdom前提)を巻き込みビルドを壊すことが
 * 判明しており(src/lib/chem.ts参照)、かつ dist にはモジュール単位のコンパイル済みJSが
 * 存在せずバンドル(index.js)経由でしか実体を取得できないため、深いimportでの回避もできない。
 * V2000は単純な固定行フォーマットなので、必要な範囲(元素・結合)だけを自前で読む。
 */

export interface MolfileAtom {
  element: string;
}

/** V2000のbond typeそのまま: 1=単結合, 2=二重結合, 3=三重結合, 4=芳香族 */
export type MolfileBondOrder = 1 | 2 | 3 | 4;

export interface MolfileBond {
  /** 0-indexed */
  begin: number;
  /** 0-indexed */
  end: number;
  order: MolfileBondOrder;
}

export interface ParsedMolfile {
  atoms: MolfileAtom[];
  bonds: MolfileBond[];
}

export function parseMolfileV2000(molfile: string): ParsedMolfile {
  const lines = molfile.split(/\r?\n/);
  const countsLine = lines[3] ?? "";
  const countsTokens = countsLine.trim().split(/\s+/);
  const atomCount = parseInt(countsTokens[0] ?? "0", 10);
  const bondCount = parseInt(countsTokens[1] ?? "0", 10);

  const atoms: MolfileAtom[] = [];
  for (let i = 0; i < atomCount; i++) {
    const line = lines[4 + i] ?? "";
    const tokens = line.trim().split(/\s+/);
    // x y z element ...
    const element = tokens[3] ?? "";
    atoms.push({ element });
  }

  const bonds: MolfileBond[] = [];
  for (let i = 0; i < bondCount; i++) {
    const line = lines[4 + atomCount + i] ?? "";
    const tokens = line.trim().split(/\s+/);
    const begin = parseInt(tokens[0] ?? "0", 10) - 1;
    const end = parseInt(tokens[1] ?? "0", 10) - 1;
    const order = parseInt(tokens[2] ?? "1", 10) as MolfileBondOrder;
    if (Number.isNaN(begin) || Number.isNaN(end)) continue;
    bonds.push({ begin, end, order });
  }

  return { atoms, bonds };
}
