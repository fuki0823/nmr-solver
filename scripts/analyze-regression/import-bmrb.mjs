// BMRB(Biological Magnetic Resonance Data Bank)代謝物エントリから、回帰テスト用の
// 化合物データ(compounds/<id>.json)を作るインポーター。
//
//   node scripts/analyze-regression/import-bmrb.mjs <bmse ID> <化合物id> <PubChem CID> "<表示名>" "<分類1,分類2,...>"
//
// 使うデータ(すべてBMRBの実測・帰属データ。推定値は使わない):
//  - ¹³C: 帰属済み化学シフト(Atom_chem_shift)の炭素。1原子=1本として記録する
//    (重なっていても帰属上区別できる炭素は別々に記録する、という方針に合わせる)。
//  - ¹H: 帰属済み化学シフトの水素を、同じシフト値ごとにまとめた本数を積分値とする
//    (1D ¹HスペクトルのBMRB積分値は相対値で規格化されていないため使わない)。
//    多重度は 1D ¹H ピークリストの記載から付ける(一意に対応するものだけ)。
//  - HSQC / HMBC / COSY: 2Dピークリストのうち、両次元が原子に帰属されているピーク。
//    帰属された原子を、上記の¹H/¹³Cピークへ対応付けて相関とする。
//  - 構造・分子式・分子量: PubChem(CID指定)。BMRBのInChIと一致するかを照合する。
// MSの実測値はBMRBに無いため、PubChemの平均分子量を「理論値」として入力に使う。

import { writeFileSync } from "node:fs";
import { carbonTypesFor, fetchBmrbEntry, loopRows, multiplicitiesFor } from "./bmrb-star.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [bmse, id, cidArg, name, categoriesArg] = process.argv.slice(2);
if (!bmse || !id || !cidArg || !name) {
  console.error('usage: import-bmrb.mjs <bmse ID> <id> <PubChem CID> "<name>" "<categories>"');
  process.exit(2);
}
const cid = Number(cidArg);
const OUT = join(dirname(fileURLToPath(import.meta.url)), "compounds", `${id}.json`);

// ---- 取得 ----
const frames = await fetchBmrbEntry(bmse);
const pc = (
  await (
    await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/Title,MolecularFormula,MolecularWeight,ConnectivitySMILES,InChIKey,InChI/JSON`,
    )
  ).json()
).PropertyTable.Properties[0];

// ---- 構造照合(BMRBのInChIとPubChemのInChIの骨格部分) ----
const bmrbInchi =
  frames.map((f) => f.tags["_Chem_comp.InChI_code"]).find((v) => v && v.startsWith("InChI=")) ?? "";
// 分子式 + 接続層。水和物等の多成分InChI(例: C27H30O16.3H2O)は主成分(最初の成分)だけを比べる。
const layer = (inchi) => {
  const [, formula = "", connections = ""] = inchi.split("/");
  return `${formula.split(".")[0]}/${connections.split(";")[0]}`;
};
const structureMatches = layer(bmrbInchi) === layer(pc.InChI);

// ---- 原子・結合・帰属シフト ----
const shifts = loopRows(frames, "_Atom_chem_shift.ID").map((r) => ({
  atom: r["_Atom_chem_shift.Atom_ID"],
  type: r["_Atom_chem_shift.Atom_type"],
  val: Number(r["_Atom_chem_shift.Val"]),
  ambiguity: r["_Atom_chem_shift.Ambiguity_code"],
}));
const bonds = loopRows(frames, "_Chem_comp_bond.ID").map((r) => [
  r["_Chem_comp_bond.Atom_ID_1"],
  r["_Chem_comp_bond.Atom_ID_2"],
]);
const atomTypes = Object.fromEntries(
  loopRows(frames, "_Chem_comp_atom.Atom_ID").map((r) => [r["_Chem_comp_atom.Atom_ID"], r["_Chem_comp_atom.Type_symbol"]]),
);
const heavyOf = {};
for (const [a, b] of bonds) {
  if (atomTypes[a] === "H") heavyOf[a] = b;
  if (atomTypes[b] === "H") heavyOf[b] = a;
}

// ¹³C: 1原子1本(シフト降順)
const carbons = shifts.filter((s) => s.type === "C").sort((a, b) => b.val - a.val);
const c13 = carbons.map((c) => c.val);
// DEPT-90/135 の実測ピークから決めた炭素の種類(検出されたピークに基づくものだけ)
const c13Types = carbonTypesFor(frames, c13);
const carbonPeakIdOfAtom = Object.fromEntries(carbons.map((c, i) => [c.atom, `C${i + 1}`]));

// ¹H: 同じシフト値の水素をまとめ、本数を積分値にする(シフト降順)
const hydrogens = shifts.filter((s) => s.type === "H");

// メチル基のHの帰属の補正。BMRBでは曖昧さコード付きの帰属で、1つのメチル基の
// 3個のHに別々の値が入っていることがある(例: コルヒチンの4個のOCH3)。メチル基の
// 3個のHは等価なので、必ず同じ値でなければならない。値を共有するメチル基の組ごとに、
// 値の種類数とメチル基の数が一致すれば「どのメチルがどの値か」が曖昧なだけなので、
// 各メチル基に値を1つずつ割り当てる。一致しなければ ¹H の帰属は信頼できないとする。
const methylCarbons = Object.keys(atomTypes).filter(
  (c) => atomTypes[c] === "C" && Object.values(heavyOf).filter((x) => x === c).length === 3,
);
const methylValues = new Map(methylCarbons.map((c) => [c, hydrogens.filter((h) => heavyOf[h.atom] === c)]));
const scrambled = methylCarbons.filter((c) => new Set(methylValues.get(c).map((h) => h.val)).size > 1);
let hydrogenAssignmentUnreliable = false;
const methylFixNotes = [];
const visited = new Set();
for (const start of scrambled) {
  if (visited.has(start)) continue;
  // 値を共有するメチル基をまとめる
  const component = [];
  const queue = [start];
  visited.add(start);
  while (queue.length) {
    const c = queue.pop();
    component.push(c);
    const vals = new Set(methylValues.get(c).map((h) => h.val));
    for (const other of scrambled) {
      if (visited.has(other)) continue;
      if (methylValues.get(other).some((h) => vals.has(h.val))) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  const distinct = [...new Set(component.flatMap((c) => methylValues.get(c).map((h) => h.val)))].sort((a, b) => b - a);
  if (distinct.length === component.length) {
    component.forEach((c, i) => methylValues.get(c).forEach((h) => (h.val = distinct[i])));
    methylFixNotes.push(`メチル基${component.length}個(${component.join(",")})のHに値 ${distinct.join(" / ")} が入れ替わって帰属されていたため、各メチル基に1つずつ割り当てた(どのメチルがどの値かは区別しない)。`);
  } else {
    hydrogenAssignmentUnreliable = true;
    methylFixNotes.push(`メチル基${component.length}個のHに${distinct.length}種類の値が混在して帰属されており、メチル基ごとの値を復元できない。¹H の帰属は信頼できない。`);
  }
}
const hGroups = new Map();
for (const h of hydrogens) {
  const key = h.val.toFixed(3);
  if (!hGroups.has(key)) hGroups.set(key, { shift: h.val, atoms: [] });
  hGroups.get(key).atoms.push(h.atom);
}
const h1Groups = [...hGroups.values()].sort((a, b) => b.shift - a.shift);
// 多重度は 1D ¹H ピークリストの記載(±0.01 ppm で一意に対応するもの)を付ける
const h1Multiplicity = multiplicitiesFor(frames, h1Groups.map((g) => g.shift));
const h1 = h1Groups.map((g, i) => (h1Multiplicity[i] ? [g.shift, g.atoms.length, h1Multiplicity[i]] : [g.shift, g.atoms.length]));
const protonPeakIdOfAtom = {};
h1Groups.forEach((g, i) => g.atoms.forEach((a) => (protonPeakIdOfAtom[a] = `H${i + 1}`)));

// ---- 2D 相関(両次元が帰属済みのピークのみ) ----
const correlations = [];
const correlationStats = {};
for (const f of frames) {
  const expName = f.tags["_Spectral_peak_list.Experiment_name"] ?? "";
  const kind = /HSQC|HMQC/i.test(expName) ? "HSQC" : /HMBC/i.test(expName) ? "HMBC" : /COSY/i.test(expName) ? "COSY" : null;
  if (!kind) continue;
  const assigned = f.loops.find((l) => l.tags.includes("_Assigned_peak_chem_shift.Peak_ID"));
  const dims = f.loops.find((l) => l.tags.includes("_Spectral_dim.ID"));
  const dimType = Object.fromEntries((dims?.rows ?? []).map((r) => [r["_Spectral_dim.ID"], r["_Spectral_dim.Atom_type"]]));
  const byPeak = new Map();
  for (const r of assigned?.rows ?? []) {
    const pid = r["_Assigned_peak_chem_shift.Peak_ID"];
    const dim = r["_Assigned_peak_chem_shift.Spectral_dim_ID"];
    const atom = r["_Assigned_peak_chem_shift.Atom_ID"];
    if (!atom || atom === "?" || atom === ".") continue;
    if (!byPeak.has(pid)) byPeak.set(pid, {});
    const entry = byPeak.get(pid);
    (entry[dim] ??= new Set()).add(atom);
  }
  const seen = new Set();
  let total = 0;
  let used = 0;
  const push = (from, to) => {
    if (kind === "COSY") {
      if (from === to) return false; // 対角ピーク
      if (from > to) [from, to] = [to, from];
    }
    const key = `${kind}:${from}:${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    correlations.push({ kind, from, to });
    return true;
  };
  // 帰属の無い(座標のみの)ピークリスト: 座標に最も近い¹H/¹³Cピークへ対応付ける。
  // 許容差内の候補が1つに決まらない場合は曖昧なので使わない。
  if (byPeak.size === 0) {
    const coords = new Map();
    for (const l of f.loops) {
      const isTransition = l.tags.includes("_Spectral_transition_char.Chem_shift_val");
      const isPeak = l.tags.includes("_Peak_char.Chem_shift_val");
      if (!isTransition && !isPeak) continue;
      const pre = isTransition ? "_Spectral_transition_char." : "_Peak_char.";
      for (const r of l.rows) {
        const pid = isTransition ? r[pre + "Spectral_transition_ID"] : r[pre + "Peak_ID"];
        const type = dimType[r[pre + "Spectral_dim_ID"]];
        if (!coords.has(pid)) coords.set(pid, {});
        (coords.get(pid)[type] ??= []).push(Number(r[pre + "Chem_shift_val"]));
      }
    }
    const nearest = (val, list, tol) => {
      const hits = list.map((v, i) => [Math.abs(v - val), i]).filter(([d]) => d <= tol);
      return hits.length === 1 ? hits[0][1] : -1;
    };
    const hShifts = h1.map(([s]) => s);
    for (const [, c] of coords) {
      total++;
      if (kind === "COSY") {
        const hs = c.H ?? [];
        if (hs.length < 2) continue;
        const a = nearest(hs[0], hShifts, 0.03);
        const b = nearest(hs[1], hShifts, 0.03);
        if (a < 0 || b < 0) continue;
        if (push(`H${a + 1}`, `H${b + 1}`)) used++;
      } else {
        const h = c.H?.[0];
        const cv = c.C?.[0];
        if (h == null || cv == null) continue;
        const a = nearest(h, hShifts, 0.03);
        const b = nearest(cv, c13, 0.5);
        if (a < 0 || b < 0) continue;
        if (push(`H${a + 1}`, `C${b + 1}`)) used++;
      }
    }
    correlationStats[kind] = { experiment: expName, peaks: total, used, method: "座標で対応付け" };
    continue;
  }
  for (const [, dimsAtoms] of byPeak) {
    total++;
    const dimIds = Object.keys(dimsAtoms);
    if (dimIds.length < 2) continue;
    const peaksOf = (dim) =>
      [...dimsAtoms[dim]].map((a) => (dimType[dim] === "C" ? carbonPeakIdOfAtom[a] : protonPeakIdOfAtom[a])).filter(Boolean);
    const [d1, d2] = dimIds;
    const p1 = [...new Set(peaksOf(d1))];
    const p2 = [...new Set(peaksOf(d2))];
    // 1つのピークが複数の¹H/¹³Cピークに帰属される(重なり)場合は曖昧なので使わない
    if (p1.length !== 1 || p2.length !== 1) continue;
    const [from, to] = dimType[d1] === "H" ? [p1[0], p2[0]] : [p2[0], p1[0]];
    if (push(from, to)) used++;
  }
  correlationStats[kind] = { experiment: expName, peaks: total, used, method: "帰属で対応付け" };
}

// ---- 測定条件 ----
const solvent =
  loopRows(frames, "_Sample_component.ID").find((r) => /^solvent$/i.test(r["_Sample_component.Type"] ?? ""))?.["_Sample_component.Mol_common_name"] ?? null;
const temperature = loopRows(frames, "_Sample_condition_variable.Type").find((r) => r["_Sample_condition_variable.Type"] === "temperature");
const field = frames.map((f) => f.tags["_NMR_spectrometer.Field_strength"]).find(Boolean) ?? null;
const experiments = loopRows(frames, "_Experiment.ID").map((r) => r["_Experiment.Name"]);

// ---- 整合性チェック ----
const formulaCount = (el) => Number(pc.MolecularFormula.match(new RegExp(`${el}(\\d*)(?![a-z])`))?.[1] || (pc.MolecularFormula.match(new RegExp(`${el}(?![a-z])`)) ? 1 : 0));
const nC = formulaCount("C");
const nH = formulaCount("H");
const carbonBoundH = hydrogens.filter((h) => atomTypes[heavyOf[h.atom]] === "C").length;
const checks = [
  ...methylFixNotes,
  ...(hydrogenAssignmentUnreliable ? ["このため ¹H と 2D 相関は入力に含めず、¹³C と分子量だけで評価する。"] : []),
  `構造照合: BMRBのInChI(分子式・接続層)とPubChem CID ${cid} が${structureMatches ? "一致" : "不一致"}。`,
  `¹³C ${c13.length}本(帰属炭素数) / 分子式の炭素数 ${nC}。DEPT で種類を付けたもの ${c13Types.filter(Boolean).length}本。`,
  `¹H 積分合計 ${hydrogens.length}H(帰属された水素の数、うち炭素上 ${carbonBoundH}H) / 分子式の水素数 ${nH}。`,
  `2D相関(一意に対応付けられたもののみ): ${Object.entries(correlationStats).map(([k, v]) => `${k} ${v.used}/${v.peaks}(${v.method})`).join(", ") || "なし"}。`,
];
const ambiguous = shifts.filter((s) => s.ambiguity && !["1", "?", "."].includes(s.ambiguity)).length;
if (ambiguous) checks.push(`帰属の曖昧さコード(1以外)が付いたシフトが${ambiguous}個ある(値自体は実測値。どの原子かの帰属が入れ替わりうる)。`);

const record = {
  id,
  name,
  categories: (categoriesArg ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  status: structureMatches ? "active" : "needs-review",
  structure: {
    pubchemCid: cid,
    molecularFormula: pc.MolecularFormula,
    smiles: pc.ConnectivitySMILES,
    inchiKey: pc.InChIKey,
  },
  conditions: {
    solvent,
    frequency: field ? `${field} MHz` : null,
    temperature: temperature ? `${temperature["_Sample_condition_variable.Val"]} ${temperature["_Sample_condition_variable.Val_units"]}` : null,
    experiments,
  },
  source: {
    type: "literature-database",
    citation: `BMRB ${bmse} (${frames.map((f) => f.tags["_Entry.Title"]).find(Boolean) ?? ""}). https://bmrb.io/metabolomics/mol_summary/show_data.php?id=${bmse}`,
    reliability: "BMRB代謝物データベースの純品の実測・帰属データ。",
  },
  input: {
    ms: { molecularWeight: Number(pc.MolecularWeight), note: "PubChemの平均分子量(構造から計算した理論値)。BMRBにMS実測値は無い。" },
    // ¹Hの帰属が信頼できない場合は、¹Hと(¹Hの帰属に依存する)2D相関を使わない
    h1: hydrogenAssignmentUnreliable ? [] : h1,
    c13: c13.map((s, i) => (c13Types[i] ? [s, c13Types[i]] : s)),
    correlations: hydrogenAssignmentUnreliable ? [] : correlations,
  },
  notes: checks,
};
writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");
console.log(`${id}: ${pc.Title} ${pc.MolecularFormula} -> ${OUT}`);
for (const c of checks) console.log("  " + c);
console.log(`  溶媒 ${solvent} / ${field} MHz / ${record.conditions.temperature}`);
