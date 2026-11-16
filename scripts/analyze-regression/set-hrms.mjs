// BMRB 由来の化合物データの MS を、高分解能 MS(測定 m/z + イオン種)の形にする。
//
// BMRB には MS の実測値が無いため、PubChem のモノアイソトピック質量から m/z を計算した
// 「理論値」を使う(実測値ではないことを note に明記する)。実際の HRMS を模して、
// 化合物 id から決まる固定の誤差(±3 ppm 以内)を加え、許容誤差は 5 ppm とする。
// 誤差は id のハッシュで決めるので、何度実行しても同じ値になる。
//
//   node scripts/analyze-regression/set-hrms.mjs

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "compounds");
const ELECTRON = 0.000549;
const ADDUCT = {
  "[M+H]+": 1.007825 - ELECTRON,
  "[M+Na]+": 22.98977 - ELECTRON,
  "[M-H]-": -1.007825 + ELECTRON,
};
// 官能基に応じて、実際に観測されやすいイオン種を選ぶ(カルボン酸は負イオン、
// 配糖体はナトリウム付加体が強く出やすい)。それ以外は [M+H]+。
const ADDUCT_BY_ID = {
  glutathione: "[M-H]-",
  biotin: "[M-H]-",
  "aminopenicillanic-acid": "[M-H]-",
  rutin: "[M+Na]+",
  neohesperidin: "[M+Na]+",
  triclosan: "[M-H]-",
  "tetrabromobisphenol-a": "[M-H]-",
};

function errorPpm(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return Math.round(((h % 6001) / 1000 - 3) * 10) / 10; // -3.0 〜 +3.0 ppm(0.1刻み)
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const path = join(DIR, file);
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  if (data.source?.type !== "literature-database") continue;
  const baseId = data.id.replace(/-dept$/, "");
  const cid = data.structure.pubchemCid;
  const pc = await (
    await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MonoisotopicMass/JSON`)
  ).json();
  const mono = Number(pc.PropertyTable.Properties[0].MonoisotopicMass);
  const adduct = ADDUCT_BY_ID[baseId] ?? "[M+H]+";
  const exact = mono + ADDUCT[adduct];
  const err = errorPpm(baseId);
  const measured = Math.round(exact * (1 + err / 1e6) * 10000) / 10000;
  // C・H・N・O・S 以外の元素は「含まれうる元素」として指定する。Cl・Br は MS の同位体
  // パターンで分かる。F・I・P は同位体では分からないので、¹⁹F/³¹P NMR 等で分かっている想定。
  const extra = ["Cl", "Br", "F", "I", "P"].filter((e) => new RegExp(`${e}(?![a-z])`).test(data.structure.molecularFormula));
  const elementNote = extra.length
    ? ` 含まれうる元素として ${extra.join("・")} を指定した(${extra.some((e) => e === "Cl" || e === "Br") ? "Cl・Br は同位体パターンで分かる想定" : ""}${extra.some((e) => ["F", "I", "P"].includes(e)) ? `${extra.some((e) => e === "Cl" || e === "Br") ? "、" : ""}F・I・P は ¹⁹F/³¹P NMR 等で分かっている想定` : ""})。`
    : "";
  data.input.ms = {
    measuredMz: measured,
    ionAdduct: adduct,
    massTolerancePpm: 5,
    ...(extra.length ? { elements: extra } : {}),
    note: `高分解能MSを模した理論値(実測値ではない): PubChem のモノアイソトピック質量 ${mono} から ${adduct} の m/z ${exact.toFixed(4)} を計算し、測定誤差として ${err >= 0 ? "+" : ""}${err} ppm を加えた。許容誤差 5 ppm。${elementNote}`,
  };
  const json = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(path, raw.includes("\r\n") ? json.replace(/\n/g, "\r\n") : json);
  console.log(`${data.id}: ${adduct} m/z ${measured} (理論 ${exact.toFixed(4)}, ${err} ppm)`);
  await new Promise((r) => setTimeout(r, 250));
}
