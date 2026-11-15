// Analyzeモード 候補生成エンジンの回帰テスト(実データ版)。
//
// scripts/analyze-regression/compounds/*.json の各化合物について、解析パイプライン
// 全体(分子式推定 → 候補取得(ローカル+PubChem) → 評価・順位付け)を実行し、
// 正解化合物が何位に来たかを記録する。
//
// 正解判定: InChIKeyの前半14文字(原子の接続=骨格)の一致で行う。立体異性体は
// 1D NMRの本数・範囲判定では区別できない前提のため、接続が同じなら正解とみなす
// (ただし同点・立体異性体の有無は結果に明記する)。
// 正解情報は評価(順位の判定)にのみ使い、解析処理には一切渡さない。
//
// 実行方法: `npm run dev` でサーバーを起動した状態で
//   node scripts/analyze-regression.mjs [化合物id ...]
// BASE_URL環境変数でサーバーURLを変更可能(既定: http://localhost:3000)。
// 結果は scripts/analyze-regression/results/ に保存し、前回(latest.json)と比較する。
// PubChemの検索結果は日々変わりうるため、候補プールの差も結果に記録する。

import { chromium } from "playwright";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "analyze-regression");
const COMPOUND_DIR = join(ROOT, "compounds");
const RESULT_DIR = join(ROOT, "results");
const METHODS = ["MS", "1H", "13C", "COSY", "HSQC", "HMBC", "NOESY"];

const onlyIds = process.argv.slice(2);
const compounds = readdirSync(COMPOUND_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(COMPOUND_DIR, f), "utf8")))
  .filter((c) => onlyIds.length === 0 || onlyIds.includes(c.id))
  .sort((a, b) => a.id.localeCompare(b.id));

function toAnalysisInput(c) {
  const { note: _note, ...ms } = c.input.ms ?? {};
  const peaks = [
    ...(c.input.h1 ?? []).map(([shift, integration], i) => ({
      id: `H${i + 1}`,
      nucleus: "1H",
      shift,
      integration,
    })),
    ...(c.input.c13 ?? []).map((shift, i) => ({ id: `C${i + 1}`, nucleus: "13C", shift })),
  ];
  return { ms, peaks, correlations: c.input.correlations ?? [] };
}

async function runOne(page, compound) {
  const input = toAnalysisInput(compound);
  return page.evaluate(
    async ({ input, expectedSmiles }) => {
      const dbg = window.__nmrAnalyzeDebug;
      const skeleton = (key) => (key ?? "").split("-")[0];
      const run = await dbg.runAnalysis(input);
      const expectedKey = await dbg.inchiKeyOf(expectedSmiles);
      const rows = [];
      for (const e of run.evaluations) {
        let key = "";
        try {
          key = await dbg.inchiKeyOf(e.candidate.smiles);
        } catch {
          key = "";
        }
        rows.push({
          id: e.candidate.id,
          name: e.candidate.name ?? e.candidate.molecularFormula,
          formula: e.candidate.molecularFormula,
          smiles: e.candidate.smiles,
          inchiKey: key,
          totalScore: e.totalScore,
          rawScore: e.rawScore ?? e.totalScore / 100,
          excluded: e.excluded,
          exclusionReasons: e.exclusionReasons,
          scores: Object.fromEntries(
            e.results.filter((r) => r.status !== "not_evaluated").map((r) => [r.method, Math.round(r.score * 100)]),
          ),
          details: e.results.flatMap((r) => r.details.filter((d) => d.status !== "match").map((d) => `[${r.method}] ${d.summary}`)),
          isCorrect: skeleton(key) !== "" && skeleton(key) === skeleton(expectedKey),
        });
      }
      return {
        expectedInchiKey: expectedKey,
        formulaLevel: run.formulaEstimate?.estimate.level ?? null,
        formulas: run.formulaEstimate?.estimate.formulas.map((f) => f.formula) ?? [],
        extraFormulas: run.formulaEstimate?.estimate.extraFormulas?.map((f) => f.formula) ?? [],
        searchedPubchem: run.searchedPubchem,
        candidateCount: run.candidates.length,
        warnings: run.warnings ?? [],
        rows,
      };
    },
    { input, expectedSmiles: compound.structure.smiles },
  );
}

function summarize(compound, out) {
  const ranked = out.rows; // runAnalysis側で 除外以外→スコア降順 に並んでいる
  const idx = ranked.findIndex((r) => r.isCorrect);
  const correct = idx >= 0 ? ranked[idx] : null;
  const top = ranked[0] ?? null;
  // 同点を考慮した順位: 自分より厳密に高いスコアの(除外されていない)候補数+1
  let rank = null;
  let tiedWith = 0;
  if (correct && !correct.excluded) {
    // 順位・同点は丸める前のスコアで判定する(1e-9 未満の差は同点とみなす)
    const EPS = 1e-9;
    rank = 1 + ranked.filter((r) => !r.excluded && r.rawScore > correct.rawScore + EPS).length;
    tiedWith = ranked.filter((r) => !r.excluded && !r.isCorrect && Math.abs(r.rawScore - correct.rawScore) <= EPS).length;
  }
  const formulaIndex = out.formulas.indexOf(compound.structure.molecularFormula);
  const extraIndex = (out.extraFormulas ?? []).indexOf(compound.structure.molecularFormula);
  let stage;
  if (correct == null) {
    stage =
      formulaIndex < 0 && extraIndex < 0
        ? "A. MS・分子式推定: 正しい分子式が分子式候補に含まれていない"
        : formulaIndex < 0
        ? `E. 候補生成: 分子式は補助候補(${extraIndex + 1}番目)にあるが、正解構造が候補プールに含まれていない`
        : `E. 候補生成: 分子式(候補${formulaIndex + 1}番目)はあるが、正解構造が候補プール(${out.candidateCount}件)に含まれていない`;
  } else if (correct.excluded) {
    stage = "ハード制約で除外された: " + correct.exclusionReasons.join(" / ");
  } else if (rank === 1 && tiedWith === 0) {
    stage = "OK(単独1位)";
  } else if (rank === 1) {
    stage = `1位だが${tiedWith}件と同点`;
  } else {
    stage = "順位付けで逆転(下記のスコア比較を参照)";
  }
  return {
    id: compound.id,
    name: compound.name,
    expectedFormula: compound.structure.molecularFormula,
    formulaLevel: out.formulaLevel,
    formulaRank: formulaIndex >= 0 ? formulaIndex + 1 : null,
    extraFormulaRank: extraIndex >= 0 ? extraIndex + 1 : null,
    formulaCount: out.formulas.length,
    candidateCount: out.candidateCount,
    warnings: out.warnings,
    correctInPool: correct != null,
    rank,
    position: idx >= 0 ? idx + 1 : null,
    tiedWith,
    correctScore: correct?.totalScore ?? null,
    correctScores: correct?.scores ?? null,
    correctIssues: correct?.details ?? [],
    top: top && { name: top.name, formula: top.formula, totalScore: top.totalScore, scores: top.scores, isCorrect: top.isCorrect, smiles: top.smiles, issues: top.details },
    bestWrong: (() => {
      const w = ranked.find((r) => !r.isCorrect && !r.excluded);
      return w && { name: w.name, formula: w.formula, totalScore: w.totalScore, scores: w.scores, smiles: w.smiles, issues: w.details };
    })(),
    stage,
    candidatesTop10: ranked.slice(0, 10).map((r) => ({ name: r.name, totalScore: r.totalScore, isCorrect: r.isCorrect, excluded: r.excluded })),
  };
}

function scoreTable(a, b, labelA, labelB) {
  const lines = [`    | 項目 | ${labelA} | ${labelB} |`, "    |---|---:|---:|"];
  for (const m of METHODS) {
    if (a?.[m] == null && b?.[m] == null) continue;
    lines.push(`    | ${m} | ${a?.[m] ?? "-"} | ${b?.[m] ?? "-"} |`);
  }
  return lines.join("\n");
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto(`${BASE_URL}/analyze`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__nmrAnalyzeDebug?.runAnalysis, undefined, { timeout: 60000 });

  const results = [];
  // PubChemへの連続アクセスで混雑エラー(500/503)にならないよう、化合物ごとに間隔を空ける
  const pauseMs = Number(process.env.PAUSE_MS ?? 5000);
  let first = true;
  for (const c of compounds) {
    if (!first && c.status === "active") await new Promise((r) => setTimeout(r, pauseMs));
    if (c.status === "active") first = false;
    if (c.status !== "active") {
      console.log(`\n■ ${c.name} [${c.id}] — 評価対象外(${c.status}): ${c.notes?.[0] ?? ""}`);
      results.push({ id: c.id, name: c.name, status: c.status });
      continue;
    }
    process.stdout.write(`\n■ ${c.name} [${c.id}] … `);
    const started = Date.now();
    const out = await runOne(page, c);
    const s = summarize(c, out);
    s.status = "active";
    s.seconds = Math.round((Date.now() - started) / 1000);
    results.push(s);
    console.log(`${s.seconds}s`);
    console.log(`  分子式: 正解${s.expectedFormula} は候補${s.formulaRank ?? (s.extraFormulaRank ? `外(補助候補${s.extraFormulaRank}番目)` : "外")}/${s.formulaCount}件 (level=${s.formulaLevel}) / 候補プール${s.candidateCount}件`);
    for (const w of s.warnings) console.log(`  ⚠ ${w}`);
    console.log(`  結果: ${s.rank != null ? `${s.rank}位 (表示${s.position}番目, 同点${s.tiedWith}件), score ${s.correctScore}` : "順位なし"} — ${s.stage}`);
    if (s.top && !s.top.isCorrect) console.log(`  1位候補: ${s.top.name.slice(0, 80)} (${s.top.formula}) score ${s.top.totalScore}`);
    if (s.correctInPool) {
      const other = s.top && !s.top.isCorrect ? s.top : s.bestWrong;
      if (other) {
        console.log(scoreTable(s.correctScores, other.scores, "正解", s.top && !s.top.isCorrect ? "1位候補" : "最上位の不正解"));
        console.log(`    比較対象: ${other.name.slice(0, 80)} (${other.formula}) score ${other.totalScore}`);
      }
      if (s.correctIssues.length) console.log("  正解化合物の減点理由:\n" + s.correctIssues.map((d) => "    - " + d).join("\n"));
    }
  }
  await browser.close();

  // 前回結果との比較
  const latestPath = join(RESULT_DIR, "latest.json");
  const previous = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : null;
  const regressions = [];
  if (previous) {
    console.log(`\n=== 前回(${previous.timestamp})との比較 ===`);
    for (const r of results.filter((r) => r.status === "active")) {
      const p = previous.results.find((x) => x.id === r.id && x.status === "active");
      if (!p) {
        console.log(`  ${r.id}: 新規`);
        continue;
      }
      const fmt = (x) => (x.rank != null ? `${x.rank}位(同点${x.tiedWith}) ${x.correctScore}点` : "順位なし");
      const worse =
        (p.rank != null && (r.rank == null || r.rank > p.rank)) ||
        (p.rank === 1 && r.rank === 1 && r.tiedWith > p.tiedWith);
      if (worse) regressions.push(r.id);
      console.log(`  ${r.id}: ${fmt(p)} → ${fmt(r)}${worse ? "  ← 悪化" : ""}`);
    }
  }

  const active = results.filter((r) => r.status === "active");
  const top1 = active.filter((r) => r.rank === 1 && r.tiedWith === 0).length;
  const top1Tied = active.filter((r) => r.rank === 1 && r.tiedWith > 0).length;
  console.log(`\n=== 集計: 評価${active.length}件 / 単独1位 ${top1} / 同点1位 ${top1Tied} / 2位以下・候補外 ${active.length - top1 - top1Tied} / データ待ち ${results.length - active.length} ===`);
  if (regressions.length) console.log(`!!! 前回より悪化: ${regressions.join(", ")}`);

  const record = { timestamp: new Date().toISOString(), baseUrl: BASE_URL, results };
  const stamp = record.timestamp.replace(/[:.]/g, "-");
  writeFileSync(join(RESULT_DIR, `${stamp}.json`), JSON.stringify(record, null, 2) + "\n");
  if (onlyIds.length === 0) writeFileSync(latestPath, JSON.stringify(record, null, 2) + "\n");
  console.log(`結果を保存: results/${stamp}.json${onlyIds.length === 0 ? " (latest.jsonも更新)" : ""}`);
  if (regressions.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
