// Analyzeモードのハード制約ロジック(¹³C炭素数 / HSQC / HMBC)の回帰テスト。
//
// moleculeGraph.ts を経由するコードは、Node単体では拡張子なし相対import
// (例: moleculeGraph.ts自身の `./molfile`)を解決できないため、実際に
// 動いている開発/本番サーバーをPlaywrightで操作して検証する方式を
// このプロジェクトでは一貫して採っている。
//
// 本テストでは、ウィザードUIの手操作やPubChemへの実ネットワーク呼び出し
// (formula検索の結果は非決定的)を避けるため、AnalyzeView.tsx が
// 開発ビルド限定で window.__nmrAnalyzeDebug.evaluateCandidate を公開する
// デバッグフックを直接呼び出す。本番ビルドではこのフックはdead-code
// eliminationで除去される。
//
// 実行方法: `npm run dev` (または `npm run start`) でサーバーを起動した
// 状態で `node scripts/analyze-hard-constraints.test.mjs` を実行する。
// BASE_URL環境変数でサーバーのURLを変更可能(既定: http://localhost:3000)。

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function evaluate(page, input, candidate) {
  return page.evaluate(
    async ({ input, candidate }) => {
      const harness = window.__nmrAnalyzeDebug;
      if (!harness) throw new Error("__nmrAnalyzeDebug not found on window");
      const evaluation = await harness.evaluateCandidate(input, candidate);
      return evaluation;
    },
    { input, candidate },
  );
}

async function testEthylAcetateRegression(page) {
  console.log("\n[Test 1] ethyl acetate (regression: HSQC/HMBC compatible, not excluded)");
  const input = {
    ms: {},
    peaks: [
      { id: "H1", nucleus: "1H", shift: 2.04, integration: 3 },
      { id: "H2", nucleus: "1H", shift: 4.12, integration: 2 },
      { id: "H3", nucleus: "1H", shift: 1.25, integration: 3 },
      { id: "C1", nucleus: "13C", shift: 171.1 },
      { id: "C2", nucleus: "13C", shift: 60.4 },
      { id: "C3", nucleus: "13C", shift: 21.0 },
      { id: "C4", nucleus: "13C", shift: 14.2 },
    ],
    correlations: [
      { kind: "HSQC", from: "H2", to: "C2" },
      { kind: "HSQC", from: "H1", to: "C3" },
      { kind: "HSQC", from: "H3", to: "C4" },
      // 注: assignPeaksは化学的な意味づけをせず、バケット内で同じ
      // attachedH(ここでは2つのメチル基がどちらもCH3)の候補を分子内の
      // 原子index順に位置的に割り当てるため、δ21.0とδ14.2のどちらが
      // 「アセチル基のCH3」でどちらが「エチル基末端のCH3」に対応する
      // 割当先原子になるかはSMILES記述順に依存する(この近似は
      // assignPeaks.ts で既知の制限として文書化されている)。そのため
      // ここでは「どちらのメチルがどちらに割り当てられても2-3結合で
      // 説明できる」相関(各メチル→隣接する炭素1個)を選んでいる。
      { kind: "HMBC", from: "H2", to: "C1" }, // OCH2 -> C=O (3JCH)
      { kind: "HMBC", from: "H1", to: "C2" }, // メチル -> 隣接炭素 (2JCH)
      { kind: "HMBC", from: "H3", to: "C1" }, // メチル -> 隣接炭素 (2JCH)
    ],
  };
  const candidate = {
    id: "test-ethyl-acetate",
    source: "test",
    smiles: "CCOC(C)=O",
    molecularFormula: "C4H8O2",
    molecularWeight: 88.11,
    exactMass: 88.0524,
  };
  const evaluation = await evaluate(page, input, candidate);
  check("evaluation returned", !!evaluation);
  if (!evaluation) return;
  check("not excluded", evaluation.excluded === false, JSON.stringify(evaluation.exclusionReasons));
  const carbon = evaluation.results.find((r) => r.method === "13C");
  const hsqc = evaluation.results.find((r) => r.method === "HSQC");
  const hmbc = evaluation.results.find((r) => r.method === "HMBC");
  check("13C status is match", carbon?.status === "match", carbon?.status);
  check("HSQC status is match", hsqc?.status === "match", hsqc?.status);
  check("HMBC status is match", hmbc?.status === "match", hmbc?.status);
  check("Match Score is high (>=80)", evaluation.totalScore >= 80, String(evaluation.totalScore));
}

async function testMaleicAnhydrideSymmetry(page) {
  console.log(
    "\n[Test 2] maleic anhydride (4 carbons, 2 signals due to symmetry — must NOT be hard-rejected)",
  );
  const input = {
    ms: {},
    peaks: [
      { id: "H1", nucleus: "1H", shift: 7.0, integration: 2 },
      { id: "C1", nucleus: "13C", shift: 164.5 },
      { id: "C2", nucleus: "13C", shift: 136.4 },
    ],
    correlations: [
      { kind: "HSQC", from: "H1", to: "C2" },
      { kind: "HMBC", from: "H1", to: "C1" },
    ],
  };
  const candidate = {
    id: "test-maleic-anhydride",
    source: "test",
    smiles: "O=C1OC(=O)C=C1",
    molecularFormula: "C4H2O3",
    molecularWeight: 98.06,
    exactMass: 97.9999,
  };
  const evaluation = await evaluate(page, input, candidate);
  check("evaluation returned", !!evaluation);
  if (!evaluation) return;
  check(
    "not excluded (symmetry: 2 signals for 4 carbons is valid)",
    evaluation.excluded === false,
    JSON.stringify(evaluation.exclusionReasons),
  );
  const carbon = evaluation.results.find((r) => r.method === "13C");
  const carbonHardMismatch = carbon?.details.some((d) => d.hardConstraint && d.status === "mismatch");
  check("13C validator raised no hard constraint", !carbonHardMismatch);
  const hsqc = evaluation.results.find((r) => r.method === "HSQC");
  const hmbc = evaluation.results.find((r) => r.method === "HMBC");
  check("HSQC status is match", hsqc?.status === "match", hsqc?.status);
  check("HMBC status is match", hmbc?.status === "match", hmbc?.status);
}

async function testCarbonCountImpossible(page) {
  console.log(
    "\n[Test 3] impossible case: more ¹³C signals than the candidate has carbon atoms — must be hard-rejected",
  );
  const input = {
    ms: {},
    peaks: [
      { id: "C1", nucleus: "13C", shift: 60 },
      { id: "C2", nucleus: "13C", shift: 40 },
      { id: "C3", nucleus: "13C", shift: 30 },
      { id: "C4", nucleus: "13C", shift: 20 },
      { id: "C5", nucleus: "13C", shift: 10 },
      { id: "C6", nucleus: "13C", shift: 5 },
    ],
    correlations: [],
  };
  // エタノール(炭素2個)に対して6本の¹³Cシグナルを与える、対称性では
  // 絶対に説明できない(観測本数 > 原子数)人工的なケース。
  const candidate = {
    id: "test-impossible-count",
    source: "test",
    smiles: "CCO",
    molecularFormula: "C2H6O",
    molecularWeight: 46.07,
    exactMass: 46.0419,
  };
  const evaluation = await evaluate(page, input, candidate);
  check("evaluation returned", !!evaluation);
  if (!evaluation) return;
  check("excluded (impossible carbon count)", evaluation.excluded === true);
  check(
    "exclusion reason mentions carbon count",
    evaluation.exclusionReasons.some((r) => r.includes("13C") || r.includes("¹³C")),
    JSON.stringify(evaluation.exclusionReasons),
  );
}

async function testQuercetinVsNContainingCounterCandidate(page) {
  console.log(
    "\n[Test 4] quercetin (15 carbons, 15 signals, HSQC compatible) vs. an N-containing " +
      "counter-candidate with far fewer carbons — the N-containing candidate must be excluded",
  );
  const input = {
    ms: {},
    peaks: [
      { id: "H1", nucleus: "1H", shift: 6.19, integration: 1 },
      { id: "H2", nucleus: "1H", shift: 6.41, integration: 1 },
      { id: "H3", nucleus: "1H", shift: 7.68, integration: 1 },
      { id: "H4", nucleus: "1H", shift: 6.89, integration: 1 },
      { id: "H5", nucleus: "1H", shift: 7.55, integration: 1 },
      // 注: 以下の¹³Cシフト値は文献の実測値そのものではなく、このテストの
      // 目的(ハード制約ロジックの検証)に合わせて意図的に調整した値。
      // 理由は2点:
      // (1) このモジュールの¹³C分類はバケット境界(δ155/190等)による
      //     粗い近似であり、フラボノイドの共役カルボニルやフェノール性
      //     芳香族炭素は文献値がバケット境界をまたぎやすい。observed
      //     shiftからのバケット判定(carbonBucketFromShift)と候補構造の
      //     結合パターンからのバケット判定(classifyCarbonBucket)を
      //     一致させるため、境界内に収まる値を用いている。
      // (2) assignPeaks(既存の割当ロジック、本タスクでは変更していない)
      //     は「同一バケット内でシフトの高い観測ピークから順に、
      //     プロトン数の多い候補炭素から順に」位置的にペアリングする
      //     近似アルゴリズムであり、実際のシフト値の大小とプロトン化の
      //     有無を予測するわけではない。そのため、芳香族/アルケン
      //     バケット内でプロトン化炭素(5個)がシフト上位側になるよう
      //     値を配置し、割当が意図通り(プロトン化炭素↔プロトン化炭素)
      //     になるようにしている。
      { id: "C1", nucleus: "13C", shift: 195.0 }, // 共役カルボニル(第四級)
      { id: "C2", nucleus: "13C", shift: 154.0 }, // プロトン化芳香族C(上位5)
      { id: "C3", nucleus: "13C", shift: 152.0 }, // プロトン化芳香族C
      { id: "C4", nucleus: "13C", shift: 150.0 }, // プロトン化芳香族C
      { id: "C5", nucleus: "13C", shift: 148.0 }, // プロトン化芳香族C
      { id: "C6", nucleus: "13C", shift: 146.0 }, // プロトン化芳香族C
      { id: "C7", nucleus: "13C", shift: 144.0 }, // 第四級芳香族C(下位9)
      { id: "C8", nucleus: "13C", shift: 142.0 }, // 第四級芳香族C
      { id: "C9", nucleus: "13C", shift: 138.0 }, // 第四級芳香族C
      { id: "C10", nucleus: "13C", shift: 136.8 }, // 第四級芳香族C
      { id: "C11", nucleus: "13C", shift: 122.1 }, // 第四級芳香族C
      { id: "C12", nucleus: "13C", shift: 120.5 }, // 第四級芳香族C
      { id: "C13", nucleus: "13C", shift: 116.0 }, // 第四級芳香族C
      { id: "C14", nucleus: "13C", shift: 104.0 }, // 第四級芳香族C
      { id: "C15", nucleus: "13C", shift: 98.9 }, // 第四級芳香族C
    ],
    correlations: [
      { kind: "HSQC", from: "H1", to: "C2" },
      { kind: "HSQC", from: "H2", to: "C3" },
      { kind: "HSQC", from: "H3", to: "C4" },
      { kind: "HSQC", from: "H4", to: "C5" },
      { kind: "HSQC", from: "H5", to: "C6" },
    ],
  };
  const quercetin = {
    id: "test-quercetin",
    source: "test",
    // PubChem CID 5280343 の isomeric SMILES
    smiles: "C1=CC(=C(C=C1C2=C(C(=O)C3=C(C=C(C=C3O2)O)O)O)O)O",
    molecularFormula: "C15H10O7",
    molecularWeight: 302.24,
    exactMass: 302.0427,
  };
  // 注: これは実際に quercetin と質量が近いPubChem候補ではなく、
  // 「MSの質量許容誤差だけでは弾けないが、¹³C/HSQCの実測データを
  // 当てはめると明らかに矛盾する」N含有候補が来た場合に、本当に
  // 除外できるかを確認するための合成テストケース(カフェイン=
  // 炭素原子8個)。実データのquercetin解析で観測されていた「なぜか
  // N含有候補が生き残る」問題への対処を検証する目的。
  const nContainingCounterCandidate = {
    id: "test-n-containing-counter-candidate",
    source: "test",
    smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
    molecularFormula: "C8H10N4O2",
    molecularWeight: 194.19,
    exactMass: 194.0804,
  };

  const quercetinEval = await evaluate(page, input, quercetin);
  check("quercetin: evaluation returned", !!quercetinEval);
  if (quercetinEval) {
    check(
      "quercetin: not excluded",
      quercetinEval.excluded === false,
      JSON.stringify(quercetinEval.exclusionReasons),
    );
    const carbon = quercetinEval.results.find((r) => r.method === "13C");
    const hsqc = quercetinEval.results.find((r) => r.method === "HSQC");
    check("quercetin: 13C status is match", carbon?.status === "match", carbon?.status);
    check("quercetin: HSQC status is match", hsqc?.status === "match", hsqc?.status);
  }

  const counterEval = await evaluate(page, input, nContainingCounterCandidate);
  check("N-containing counter-candidate: evaluation returned", !!counterEval);
  if (counterEval) {
    check(
      "N-containing counter-candidate: excluded",
      counterEval.excluded === true,
      JSON.stringify(counterEval.exclusionReasons),
    );
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto(`${BASE_URL}/analyze`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__nmrAnalyzeDebug, undefined, { timeout: 15000 });

  await testEthylAcetateRegression(page);
  await testMaleicAnhydrideSymmetry(page);
  await testCarbonCountImpossible(page);
  await testQuercetinVsNContainingCounterCandidate(page);

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
