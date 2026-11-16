// DEPT を完全に読んだ(C / CH / CH2 / CH3 をすべて決めた)テストデータの変種
// compounds/<id>-dept.json を作る。元のデータは変更しない。
//
// 対象は、BMRB に DEPT-90 の強度と DEPT-135 の符号の両方が記録されている化合物だけ。
// 「出ていない」ことに基づく判定(DEPT-90 に無い → CH3、DEPT-135 に無い → C)は検出漏れで
// 誤ることがあるので、同じエントリの実測 HSQC と照合し、矛盾する炭素は判定を緩める。
//
//   node scripts/analyze-regression/make-dept-variants.mjs <化合物id ...>

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { carbonTypesFor, fetchBmrbEntry } from "./bmrb-star.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "compounds");

for (const id of process.argv.slice(2)) {
  const base = JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"));
  const bmse = base.source?.citation?.match(/bmse\d+/)?.[0];
  if (!bmse) {
    console.log(`${id}: BMRB 由来ではないため対象外`);
    continue;
  }
  const frames = await fetchBmrbEntry(bmse);
  const shifts = base.input.c13.map((c) => (Array.isArray(c) ? c[0] : c));

  // 実測 HSQC から、H が付いていると分かっている炭素と、その H の積分を集める
  const protonated = shifts.map(() => false);
  const hsqcHydrogens = shifts.map(() => null);
  const partners = shifts.map(() => new Set());
  for (const c of base.input.correlations ?? []) {
    if (c.kind !== "HSQC") continue;
    const h = c.from.startsWith("H") ? c.from : c.to;
    const cId = c.from.startsWith("C") ? c.from : c.to;
    const ci = Number(cId.slice(1)) - 1;
    protonated[ci] = true;
    partners[ci].add(Number(h.slice(1)) - 1);
  }
  partners.forEach((set, ci) => {
    if (set.size === 1) hsqcHydrogens[ci] = base.input.h1[[...set][0]][1];
  });

  const types = carbonTypesFor(frames, shifts, 0.08, { full: true, protonated, hsqcHydrogens });
  const fullTypes = types.filter((t) => ["C", "CH", "CH2", "CH3"].includes(t)).length;
  if (fullTypes === 0) {
    console.log(`${id}: DEPT を完全に読めない(DEPT-90 の強度または DEPT-135 の符号が無い、または対応付け失敗)`);
    continue;
  }
  const counts = {};
  types.forEach((t) => t && (counts[t] = (counts[t] ?? 0) + 1));
  const variant = structuredClone(base);
  variant.id = `${id}-dept`;
  variant.name = `${base.name} — DEPT(完全)`;
  variant.categories = [...(base.categories ?? []), "DEPT 入り"];
  variant.input.c13 = shifts.map((s, i) => (types[i] ? [s, types[i]] : s));
  variant.notes = (base.notes ?? []).filter((n) => !n.startsWith("DEPT:"));
  variant.notes.push(
    `DEPT(完全): BMRB ${bmse} の DEPT-90(強度あり)・DEPT-135(符号あり)を通常の読み方で解釈し、${shifts.length}本中${types.filter(Boolean).length}本に種類を付けた(${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(", ")})。実測 HSQC と矛盾する判定は緩めてある。元データ ${id} との比較用。`,
  );
  const out = join(DIR, `${variant.id}.json`);
  writeFileSync(out, JSON.stringify(variant, null, 2) + "\n");
  console.log(`${variant.id}: ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  await new Promise((r) => setTimeout(r, 300));
}
