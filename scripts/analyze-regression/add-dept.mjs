// 既存の化合物データ(BMRB由来)の ¹³C ピークに、BMRB の DEPT-90 / DEPT-135 の実測ピーク
// リストから決めた炭素の種類を付ける(詳細は bmrb-star.mjs の carbonTypesFor)。
// 構造から H の数を逆算することはしない(正解を入力に使うことになるため)。
//
//   node scripts/analyze-regression/add-dept.mjs [化合物id ...]

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { carbonTypesFor, fetchBmrbEntry } from "./bmrb-star.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "compounds");
const only = process.argv.slice(2);

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const path = join(DIR, file);
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  if (only.length && !only.includes(data.id)) continue;
  const bmse = data.source?.citation?.match(/bmse\d+/)?.[0];
  if (data.source?.type !== "literature-database" || !bmse) continue;

  const frames = await fetchBmrbEntry(bmse);
  const shifts = data.input.c13.map((c) => (Array.isArray(c) ? c[0] : c));
  const types = carbonTypesFor(frames, shifts);
  const counts = {};
  data.input.c13 = shifts.map((s, i) => {
    if (!types[i]) return s;
    counts[types[i]] = (counts[types[i]] ?? 0) + 1;
    return [s, types[i]];
  });
  const typed = Object.values(counts).reduce((a, b) => a + b, 0);
  const summary = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(", ");
  const note = typed
    ? `DEPT: BMRB ${bmse} の DEPT-90/135 実測ピークから ${shifts.length}本中${typed}本の炭素の種類を付けた(${summary})。`
    : `DEPT: BMRB ${bmse} に DEPT-135 のピークリストが無い、または対応付けられるピークが無いため付けていない。`;
  data.notes = (data.notes ?? []).filter((n) => !n.startsWith("DEPT:"));
  data.notes.push(note);
  const json = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(path, raw.includes("\r\n") ? json.replace(/\n/g, "\r\n") : json);
  console.log(`${data.id}: ${note}`);
  await new Promise((r) => setTimeout(r, 300));
}
