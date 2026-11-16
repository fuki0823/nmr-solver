import {
  computeEquivalenceClasses,
  countCarbonTypesByEquivalence,
  countDistinctCarbonEnvironments,
} from "../../moleculeGraph";
import { maxBipartiteMatching } from "../shiftRanges";
import {
  expectedCarbonRange,
  inRange,
  shiftConsistencyScore,
} from "../shiftRanges";
import { formatCarbonType, parseCarbonType } from "../dept";
import { predictAromaticCarbons } from "../prediction/aromaticIncrements";
import { predictAliphaticCarbons } from "../prediction/aliphaticIncrements";
import { minCostAssignment } from "../prediction/assignment";
import type { ValidationContext, ValidationDetail, ValidationResult } from "./types";

export function carbonValidator(context: ValidationContext): ValidationResult {
  const { input, candidateGraph } = context;
  const peaks = input.peaks.filter((p) => p.nucleus === "13C");
  if (peaks.length === 0) {
    return { method: "13C", status: "not_evaluated", score: 0, details: [] };
  }

  const details: ValidationDetail[] = [];
  let hardReject = false;

  // 1. 炭素原子数のハード制約。
  //
  // 観測される¹³Cシグナルの本数は、対称性(等価な炭素環境の重なり)や
  // シグナルの偶然の重なりによって、候補の炭素原子数より「少なく」
  // なることは常にあり得る(例: 無水マレイン酸 C4、対称性によりシグナル
  // 2本)。逆に、候補の炭素原子数より「多い」シグナル数が観測されることは
  // 物理的にあり得ない(1個の炭素原子が複数のシグナルを生むことはない)。
  // そのため、非対称に扱う: 超過のみをハード制約違反とする。
  const totalCarbonAtoms = candidateGraph.atoms.filter((a) => a.element === "C").length;
  const uniqueEnvironments = countDistinctCarbonEnvironments(candidateGraph);
  let countScore = 0.5;

  if (peaks.length > totalCarbonAtoms) {
    hardReject = true;
    countScore = 0;
    details.push({
      status: "mismatch",
      hardConstraint: true,
      summary: `¹³Cシグナル数(${peaks.length}本)が候補構造の炭素原子数(${totalCarbonAtoms}個)を超えています。1個の炭素原子から複数のシグナルが生じることはないため、対称性を考慮してもこの候補ではあり得ません。`,
    });
  } else if (uniqueEnvironments != null) {
    if (peaks.length >= uniqueEnvironments) {
      // uniqueEnvironments <= 観測本数 <= 全炭素数: 対称性や偶然の重なりで
      // 矛盾なく説明できる範囲。ハード制約としては通過させる。
      countScore = 1;
      details.push({
        status: "match",
        summary:
          peaks.length === totalCarbonAtoms
            ? `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素原子数(${totalCarbonAtoms}個)と一致します`
            : `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素原子数(${totalCarbonAtoms}個、対称性を考慮した最少${uniqueEnvironments}種類の環境)の範囲内で矛盾しません(対称性やシグナルの重なりで説明可能)`,
      });
    } else {
      // 観測本数がこちらの対称性モデルが見積もる最少環境数より少ない。
      // 判定モデルの粗さやシグナルの偶然の重なりの可能性もあるため、
      // ハード制約にはせず、差が大きいほどソフトスコアを下げるに留める。
      const diff = uniqueEnvironments - peaks.length;
      // 第四級炭素(Hを持たない)はNOE増強が無く緩和も遅いため、¹³Cで弱く
      // 観測されないことがよくある。不足分が候補の第四級炭素の環境数以内なら、
      // 「第四級炭素が観測されていない」で説明できるので減点を小さくする。
      const quaternaryEnvironments = countCarbonTypesByEquivalence(candidateGraph)?.cq ?? 0;
      const explainedByQuaternary = diff <= quaternaryEnvironments;
      countScore = explainedByQuaternary
        ? Math.max(0.7, 1 - 0.05 * diff)
        : Math.max(0, 1 - diff / Math.max(uniqueEnvironments, 1));
      details.push({
        status: diff <= 1 || explainedByQuaternary ? "partial" : "mismatch",
        summary: explainedByQuaternary
          ? `¹³Cシグナル数(${peaks.length}本)は候補構造の炭素環境(${uniqueEnvironments}種類)より${diff}本少ないですが、候補の第四級炭素(${quaternaryEnvironments}種類)が観測されていないとすれば説明できます`
          : `¹³Cシグナル数(${peaks.length}本)が、候補構造で対称性を考慮しても見積もられる最少種類数(${uniqueEnvironments}種類)より少なく、第四級炭素の未観測だけでは説明できません。`,
      });
    }
  }

  // 1b. DEPT(炭素の種類)の本数のハード制約。
  // 種類ごとに、その種類と表記されたピークの本数が、候補構造でその H 数を持つ炭素原子の
  // 数を超えることは物理的にあり得ない(1個の炭素から2本のシグナルは出ない)。
  // 「CH/CH3」のような集合も含めて、H 数のあらゆる組み合わせ S について
  //   (表記が S に含まれるピークの本数) ≤ (H 数が S に含まれる炭素原子の数)
  // を確かめる(2部マッチングが成り立つための必要条件)。
  //
  // ただしハード制約には、直接観測で決まる種類だけを使う。DEPT の「C」(DEPT-135 に
  // 出ない)と「CH3」(DEPT-135 で正だが DEPT-90 に出ない)は「出ていない」ことからの
  // 推論で、弱いピークの検出漏れで誤ることがある(実測データでルチン・シンバスタチンの
  // 糖やCHを C と判定し、正解を除外した)。そのため本数の判定では C は制約なし、CH3 は
  // CH/CH3 として扱い、C・CH3 の誤りはピーク割当(ソフトスコア)の減点に任せる。
  const carbonTypes = peaks.map((p) => parseCarbonType(p.carbonType));
  const typedPeaks = carbonTypes
    .map((t) => {
      if (t == null || (t.length === 1 && t[0] === 0)) return null;
      if (t.length === 1 && t[0] === 3) return [1, 3];
      return t;
    })
    .filter((t): t is number[] => t != null);
  const carbonAtomsAll = candidateGraph.atoms.filter((a) => a.element === "C");
  if (typedPeaks.length > 0) {
    for (let mask = 1; mask < 16; mask++) {
      const set = [0, 1, 2, 3].filter((h) => mask & (1 << h));
      const peakCount = typedPeaks.filter((t) => t.every((h) => set.includes(h))).length;
      if (peakCount === 0) continue;
      const atomCount = carbonAtomsAll.filter((a) => set.includes(a.attachedH ?? 0)).length;
      if (peakCount > atomCount) {
        hardReject = true;
        details.push({
          status: "mismatch",
          hardConstraint: true,
          summary: `DEPT: ${formatCarbonType(set)} のピークが${peakCount}本ありますが、候補構造の該当する炭素は${atomCount}個しかありません`,
        });
        break;
      }
    }
  }

  // 2. 化学シフトの整合性。各ピークを「その局所構造なら出うる範囲」に
  // 入る炭素原子へ1対1で割り当て(最大マッチング)、割り当てられた割合で
  // 評価する。範囲は重なりを許しているため、キノンC=O(δ186)やフェノール
  // C-O(δ155-160)のような境界付近の官能基も正しく扱える(詳細は
  // shiftRanges.ts)。
  const carbons = candidateGraph.atoms.filter((a) => a.element === "C");
  const ranges = carbons.map((a) => expectedCarbonRange(candidateGraph, a));
  const sortedPeaks = [...peaks].sort((a, b) => b.shift - a.shift);
  // DEPT の種類があれば、H 数が合う炭素にだけ割り当てる
  const sortedTypes = sortedPeaks.map((p) => parseCarbonType(p.carbonType));
  //
  // DEPT の C(DEPT-135 に出ない)と CH3(DEPT-90 に出ない)は、本質的に「出ていない」ことからの
  // 推論で、検出漏れで誤ることがある(シンバスタチンの実測 DEPT で CH を C と判定していた)。
  // そのため割り当てでは C・CH3 を絶対条件にせず、合わない割り当ては半分の重みの不一致として
  // 数える。直接観測で決まる CH・CH2・CH/CH3 は絶対条件のまま。
  const SOFT = 1;
  const BLOCKED = 1000;
  const labelCost = (i: number, j: number): number => {
    const t = sortedTypes[i];
    const h = carbons[j].attachedH ?? 0;
    if (t == null || t.includes(h)) return 0;
    const inferredFromAbsence = t.length === 1 && (t[0] === 0 || t[0] === 3);
    if (inferredFromAbsence && (t[0] === 0 || h === 1)) return SOFT; // C → 何でも可 / CH3 → CH なら可
    return BLOCKED;
  };
  const rangeCost = sortedPeaks.map((p, i) =>
    carbons.map((_, j) => (inRange(p.shift, ranges[j]) ? labelCost(i, j) : BLOCKED)),
  );
  const rangeAssign = sortedPeaks.length <= carbons.length ? minCostAssignment(rangeCost) : [];
  const matchLeft = sortedPeaks.map((_, i) => {
    const j = rangeAssign[i];
    return j != null && j >= 0 && rangeCost[i][j] < BLOCKED ? j : -1;
  });
  const softMismatches = matchLeft.filter((j, i) => j >= 0 && rangeCost[i][j] === SOFT).length;

  // 対称性: 小数3桁以上の精度で値が完全に一致するピークの組は、等価な炭素(分子の対称性)に
  // よるものと考えられる。候補構造の等価な炭素の組(組の大きさ以上)に1対1で対応付けられない
  // 組は、偶然の一致を仮定する必要があるので、半分の重みの不一致として数える。
  // 小数2桁以下のデータでは偶然の一致がよくある(例: SMTP-7 の 26.62 ×2)ので判定しない。
  const decimals = (x: number) => (String(x).split(".")[1] ?? "").length;
  let unexplainedDuplicates = 0;
  if (peaks.some((p) => decimals(p.shift) >= 3)) {
    const counts = new Map<number, number>();
    for (const p of peaks) counts.set(p.shift, (counts.get(p.shift) ?? 0) + 1);
    const groups = [...counts.entries()].filter(([, n]) => n >= 2);
    if (groups.length > 0) {
      const ranks = computeEquivalenceClasses(candidateGraph);
      const classSize = new Map<number, number>();
      for (const a of candidateGraph.atoms) {
        if (a.element === "C") classSize.set(ranks[a.index], (classSize.get(ranks[a.index]) ?? 0) + 1);
      }
      const classes = [...classSize.values()].filter((n) => n >= 2);
      const matched = maxBipartiteMatching(groups.length, classes.length, (g, c) => classes[c] >= groups[g][1]).filter(
        (c) => c >= 0,
      ).length;
      unexplainedDuplicates = groups.length - matched;
      if (unexplainedDuplicates > 0) {
        details.push({
          status: "partial",
          summary: `対称性: 値が完全に一致するピークの組(${groups.length}組)のうち${unexplainedDuplicates}組は、候補構造の等価な炭素では説明できません(偶然の一致を仮定する必要があります)`,
        });
      }
    }
  }
  const unmatched = sortedPeaks.filter((_, i) => matchLeft[i] < 0);
  const matchedCount = sortedPeaks.length - unmatched.length;
  const shiftScore =
    sortedPeaks.length > 0
      ? shiftConsistencyScore(
          (unmatched.length + 0.5 * softMismatches + 0.5 * unexplainedDuplicates) / sortedPeaks.length,
        )
      : 0;
  if (softMismatches > 0) {
    details.push({
      status: "partial",
      summary: `DEPT: C・CH3 と表記されたピークのうち${softMismatches}本は、H 数の違う炭素にしか割り当てられません(C・CH3 は「出ていない」ことからの推論なので、半分の重みの不一致として扱います)`,
    });
  }
  details.push({
    status: unmatched.length === 0 ? "match" : unmatched.length <= 1 ? "partial" : "mismatch",
    summary:
      unmatched.length === 0
        ? `¹³C化学シフト: ${sortedPeaks.length}本すべてを、局所構造から見て矛盾のない炭素に割り当てられます`
        : `¹³C化学シフト: ${sortedPeaks.length}本中${matchedCount}本を割り当て可能。割り当て先のないピーク: ${unmatched
            .slice(0, 6)
            .map((p) => `δ${p.shift}`)
            .join(", ")}${unmatched.length > 6 ? " ほか" : ""}`,
  });

  // DEPT が原因で説明できないピーク(シフトの合う炭素はあるが、H 数が DEPT と合わない)
  const deptConflicts = sortedPeaks.filter((p, i) => {
    const t = sortedTypes[i];
    if (t == null) return false;
    const inRangeAtoms = carbons.filter((_, j) => inRange(p.shift, ranges[j]));
    return inRangeAtoms.length > 0 && !inRangeAtoms.some((a) => t.includes(a.attachedH ?? 0));
  });
  if (deptConflicts.length > 0) {
    details.push({
      status: "mismatch",
      summary: `DEPT: ${deptConflicts
        .slice(0, 6)
        .map((p) => `δ${p.shift}(${p.carbonType})`)
        .join(", ")} は、シフトの合う炭素はあるものの、付いている H の数が DEPT と合いません`,
    });
  }

  // 3. 予測シフトとの一致(置換基加成則で予測できる炭素のみ。詳細は prediction/)。
  // シフト範囲・DEPT の条件を満たす組み合わせの中で、予測値とのずれの合計が最小になる
  // ようにピークを炭素へ割り当て(ハンガリアン法)、予測のある炭素の平均のずれ(MAD)で
  // 評価する。予測の無い炭素へのコストは典型的な誤差 3 ppm とし、割り当てを偏らせない。
  // 予測の方式ごとに典型的な誤差が違うので、満点とするずれの上限を分ける
  // (芳香環 2 ppm、sp3 炭素 4 ppm)。
  const aromaticPred = predictAromaticCarbons(candidateGraph);
  const aliphaticPred = predictAliphaticCarbons(candidateGraph);
  const METHODS = {
    aromatic: { label: "芳香環の置換基加成則", tolerance: 2 },
    aliphatic: { label: "sp3炭素の加成則", tolerance: 4 },
  } as const;
  type Method = keyof typeof METHODS;
  const predicted = carbons.map((a): { value: number; method: Method } | null =>
    aromaticPred[a.index] != null
      ? { value: aromaticPred[a.index]!, method: "aromatic" }
      : aliphaticPred[a.index] != null
        ? { value: aliphaticPred[a.index]!, method: "aliphatic" }
        : null,
  );
  let predictionScore: number | null = null;
  if (predicted.some((p) => p != null) && sortedPeaks.length <= carbons.length) {
    const DEFAULT_COST = 3;
    const INFEASIBLE = 1000;
    // 1本の予測の大外れで割り当てや平均が引きずられないよう、ずれは 10 ppm で頭打ちにする
    const MAX_DEVIATION = 10;
    const cost = sortedPeaks.map((p, i) =>
      carbons.map((a, j) => {
        if (rangeCost[i][j] >= BLOCKED) return INFEASIBLE;
        // DEPT の C・CH3 と合わない割り当ては、予測のずれ 5 ppm 分の追加コストにする
        const soft = rangeCost[i][j] === SOFT ? 5 : 0;
        const pr = predicted[j];
        // 誤差の大きい方式ほど、ずれを割り引いてコストにする(方式間で割り当てを偏らせない)
        return (
          soft +
          (pr != null
            ? Math.min(Math.abs(p.shift - pr.value), MAX_DEVIATION) * (2 / METHODS[pr.method].tolerance)
            : DEFAULT_COST)
        );
      }),
    );
    const assign = minCostAssignment(cost);
    const byMethod = new Map<Method, { obs: number; pred: number; dev: number }[]>();
    assign.forEach((j, i) => {
      const pr = predicted[j];
      if (j < 0 || cost[i][j] >= INFEASIBLE || pr == null) return;
      const list = byMethod.get(pr.method) ?? [];
      list.push({
        obs: sortedPeaks[i].shift,
        pred: pr.value,
        dev: Math.min(Math.abs(sortedPeaks[i].shift - pr.value), MAX_DEVIATION),
      });
      byMethod.set(pr.method, list);
    });
    // 点数は「各方式の典型的な誤差(tolerance)を超えたずれ」の合計から出し、観測ピークの
    // 本数(どの候補でも同じ)で割る。予測できた炭素の数で平均すると、許容範囲内に収まる
    // 炭素を多く持つ候補ほど有利になる偏りが生じた(ダウノルビシンで異性体が逆転した)。
    let excess = 0;
    let anyMethod = false;
    for (const [method, deviations] of byMethod) {
      if (deviations.length < 3) continue;
      anyMethod = true;
      const { label, tolerance } = METHODS[method];
      const mad = deviations.reduce((s, d) => s + d.dev, 0) / deviations.length;
      excess += deviations.reduce((s, d) => s + Math.max(0, d.dev - tolerance), 0);
      const worst = [...deviations].sort((a, b) => b.dev - a.dev).slice(0, 3);
      details.push({
        status: mad <= tolerance + 1 ? "match" : mad <= tolerance + 3 ? "partial" : "mismatch",
        summary: `予測シフト(${label}): 予測できる炭素${deviations.length}本の平均のずれ ${mad.toFixed(1)} ppm(ずれの大きいもの: ${worst
          .map((d) => `δ${d.obs} ↔ 予測${d.pred}`)
          .join(", ")})`,
      });
    }
    if (anyMethod) predictionScore = Math.exp(-excess / (2 * sortedPeaks.length));
  }

  // 範囲ごとの内訳(参考表示)。候補構造の炭素がどの種類に何個あるか。
  const labelCounts = new Map<string, number>();
  for (const r of ranges) labelCounts.set(r.label, (labelCounts.get(r.label) ?? 0) + 1);
  details.push({
    status: "match",
    summary: `候補構造の炭素の内訳: ${Array.from(labelCounts.entries())
      .map(([label, n]) => `${label}${n}`)
      .join(" / ")}`,
  });

  // 本数の一致は同じ分子式の候補同士ではほぼ差が出ないため、構造の違いが
  // 表れる化学シフトの整合性を2倍に重み付けする。
  // 予測シフトがあれば、範囲による判定と同じ重みで加える(同じ分子式の異性体を区別する
  // 主な手がかりになるため)。
  const score = hardReject
    ? 0
    : predictionScore != null
      ? (countScore + 2 * shiftScore + 2 * predictionScore) / 5
      : (countScore + 2 * shiftScore) / 3;
  const status = hardReject ? "mismatch" : score >= 0.8 ? "match" : score >= 0.4 ? "partial" : "mismatch";

  return { method: "13C", status, score, details };
}
