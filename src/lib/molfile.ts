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

/**
 * V2000 は固定幅の書式なので、空白区切りではなく桁位置で読む。
 * 原子数・結合数・結合の原子番号はそれぞれ3文字幅で、100以上になると隣の欄と
 * 空白なしでつながる(例: 原子101個・結合110個の counts 行は "101110 ...")。
 * 空白区切りで読むと、原子が100個を超える分子(バンコマイシン等)を壊してしまう。
 */
const field = (line: string, start: number, width: number): number =>
  parseInt(line.substring(start, start + width).trim() || "NaN", 10);

export function parseMolfileV2000(molfile: string): ParsedMolfile {
  const lines = molfile.split(/\r?\n/);
  const countsLine = lines[3] ?? "";
  const atomCount = field(countsLine, 0, 3) || 0;
  const bondCount = field(countsLine, 3, 3) || 0;

  const atoms: MolfileAtom[] = [];
  for (let i = 0; i < atomCount; i++) {
    const line = lines[4 + i] ?? "";
    // 座標 x y z(各10文字)+ 空白1文字 の後、32〜34文字目が元素記号
    const element = line.substring(31, 34).trim() || (line.trim().split(/\s+/)[3] ?? "");
    atoms.push({ element });
  }

  const bonds: MolfileBond[] = [];
  for (let i = 0; i < bondCount; i++) {
    const line = lines[4 + atomCount + i] ?? "";
    // 1つ目の原子・2つ目の原子・結合の種類(各3文字)
    const begin = field(line, 0, 3) - 1;
    const end = field(line, 3, 3) - 1;
    const orderValue = field(line, 6, 3);
    const order = (Number.isNaN(orderValue) ? 1 : orderValue) as MolfileBondOrder;
    if (Number.isNaN(begin) || Number.isNaN(end)) continue;
    bonds.push({ begin, end, order });
  }

  return { atoms, bonds };
}
