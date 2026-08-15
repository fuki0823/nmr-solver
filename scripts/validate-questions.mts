/**
 * questions.ts のデータをプログラム的にチェックするスクリプト。
 *
 * 目的はあくまで「機械的に検出できる構造上の欠落・矛盾」の検出であり、
 * NMR相関(COSY/HSQC/HMBCの相関が化学的に正しいかなど)の化学的妥当性
 * そのものを判定するものではない(それは出題時の手作業での検証に依存する)。
 *
 * 実行方法: npm run validate
 * (Node 22+ のTypeScriptネイティブ実行を利用。ビルド設定は変更していない)
 */
import { questions } from "../src/data/questions.ts";
import type { AnalysisMethod, Question } from "../src/lib/types.ts";

type Level = "error" | "warn";
interface Issue {
  level: Level;
  questionId: number | "N/A";
  message: string;
}

const issues: Issue[] = [];

function report(level: Level, questionId: number | "N/A", message: string) {
  issues.push({ level, questionId, message });
}

// --- 重複ID ---
const seenIds = new Map<number, number>();
for (const q of questions) {
  seenIds.set(q.id, (seenIds.get(q.id) ?? 0) + 1);
}
for (const [id, count] of seenIds) {
  if (count > 1) report("error", id, `id ${id} が ${count} 回重複しています。`);
}

// --- 各問題のフィールドチェック ---
for (const q of questions) {
  const ctx = q.id;

  if (!q.compoundName?.trim()) report("error", ctx, "compoundName が空です。");
  if (!q.explanation?.trim()) report("error", ctx, "explanation が空です。");
  if (!q.correctSmiles?.trim()) report("error", ctx, "correctSmiles が空です。");
  if (!q.molecularFormula?.trim())
    report("error", ctx, "molecularFormula が空です。");
  if (!/^([A-Z][a-z]?\d*)+$/.test(q.molecularFormula ?? "")) {
    report(
      "warn",
      ctx,
      `molecularFormula "${q.molecularFormula}" が想定した分子式の形式(例: C10H16O)と異なります。`,
    );
  }
  if (!q.hNmr || q.hNmr.length === 0) {
    report("error", ctx, "hNmr が空です。");
  }
  if (!q.hints || q.hints.length !== 3 || q.hints.some((h) => !h?.trim())) {
    report("error", ctx, "hints が3段階すべて揃っていません。");
  }

  // correctSmiles の簡易な文字種チェック(化学的妥当性ではなく構文レベル)
  if (q.correctSmiles && /[^A-Za-z0-9@+\-[\]()=#/\\%.:]/.test(q.correctSmiles)) {
    report(
      "warn",
      ctx,
      `correctSmiles "${q.correctSmiles}" にSMILESとして想定外の文字が含まれています。`,
    );
  }

  // 天然物レベル(molecularWeightを表示)の問題は exactMass も期待する
  if (q.molecularWeight != null && q.exactMass == null) {
    report(
      "warn",
      ctx,
      "molecularWeight はあるが exactMass がありません(任意項目ですが確認してください)。",
    );
  }

  checkMethodsConsistency(q, ctx);
}

function checkMethodsConsistency(q: Question, ctx: number) {
  const present = new Set<AnalysisMethod>(["1H"]);
  if (q.cNmr && q.cNmr.length > 0) present.add("13C");
  if (q.dept) present.add("DEPT");
  if (q.cosy) present.add("COSY");
  if (q.hsqc && q.hsqc.length > 0) present.add("HSQC");
  if (q.hmbc && q.hmbc.length > 0) present.add("HMBC");

  if (!q.methods) return; // methods省略時は一覧側が自動推定するため対象外

  const declared = new Set(q.methods);

  for (const m of declared) {
    if (m === "NOESY") continue; // NOESYは現状データ構造未定義のため対象外
    if (!present.has(m)) {
      report(
        "error",
        ctx,
        `methods に "${m}" が指定されていますが、対応するデータがありません。`,
      );
    }
  }
  for (const m of present) {
    if (!declared.has(m)) {
      report(
        "error",
        ctx,
        `"${m}" のデータが存在しますが、methods に含まれていません。`,
      );
    }
  }
}

// --- 出力 ---
const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warn");

for (const i of [...errors, ...warnings]) {
  const tag = i.level === "error" ? "ERROR" : "WARN ";
  console.log(`[${tag}] Q${i.questionId}: ${i.message}`);
}

console.log(
  `\n${questions.length} 問中、error ${errors.length} 件・warning ${warnings.length} 件`,
);

if (errors.length > 0) {
  process.exitCode = 1;
}
