// 既存の化合物データ(BMRB由来)の ¹H ピークに、BMRB の 1D ¹H ピークリストに記載された
// 多重度を追記する。他の項目(手作業で修正したデータ等)は変更しない。
//
//   node scripts/analyze-regression/add-multiplicity.mjs [化合物id ...]

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBmrbEntry, multiplicitiesFor } from "./bmrb-star.mjs";

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
  const h1 = data.input.h1;
  const mults = multiplicitiesFor(frames, h1.map(([s]) => s));
  let added = 0;
  data.input.h1 = h1.map(([shift, integration], i) => {
    if (mults[i]) {
      added++;
      return [shift, integration, mults[i]];
    }
    return [shift, integration];
  });
  const note = `多重度: BMRB ${bmse} の 1D ¹H ピークリストの記載(±0.01 ppm で一意に対応するもの)を ${h1.length}本中${added}本に付けた。`;
  data.notes = (data.notes ?? []).filter((n) => !n.startsWith("多重度:"));
  data.notes.push(note);
  const json = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(path, raw.includes("\r\n") ? json.replace(/\n/g, "\r\n") : json);
  console.log(`${data.id}: ${note}`);
  await new Promise((r) => setTimeout(r, 300));
}
