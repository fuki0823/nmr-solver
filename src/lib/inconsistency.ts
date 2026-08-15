import type { Question } from "./types";
import {
  buildMoleculeGraph,
  countCarbonTypesByEquivalence,
  countDistinctCarbonEnvironments,
  computeSpinSystemIslands,
  type MoleculeGraph,
} from "./moleculeGraph";

/**
 * 「提出構造 vs 観測されたスペクトルデータ」を決定論的に比較し、矛盾点を
 * 検出するモジュール。判定ロジックはすべてこのファイル(と moleculeGraph.ts)
 * の純粋なコードで完結しており、LLMは一切関与しない。
 *
 * ここで検出するのはMVP範囲(分子式/MW・DEPT由来の炭素タイプ本数・COSYの
 * スピン系の形)のみ。HMBC/COSY/HSQCの「特定の1本の相関」を原子レベルで
 * 検証するには、提出構造と正解構造の原子対応付け(atom mapping)が必要で、
 * 現時点では一般には解けないため実装していない(できないふりをしない)。
 */

export type InconsistencyMethod = "formula" | "DEPT" | "13C" | "COSY";

export interface Inconsistency {
  method: InconsistencyMethod;
  /** Level 1: どの解析法と矛盾するか */
  level1: string;
  /** Level 2: 具体的にどう矛盾するか */
  level2: string;
}

export function analyzeInconsistencies(
  molfile: string,
  question: Question,
): Inconsistency[] {
  const graph = buildMoleculeGraph(molfile);
  if (graph.hasUnsupportedElement) return [];

  const inconsistencies: Inconsistency[] = [];

  const formulaIssue = checkFormula(graph, question);
  if (formulaIssue) inconsistencies.push(formulaIssue);

  if (question.dept) {
    const deptIssue = checkDept(graph, question);
    if (deptIssue) inconsistencies.push(deptIssue);
  } else if (question.cNmr && question.cNmr.length > 0) {
    const carbonCountIssue = checkCarbonSignalCount(graph, question);
    if (carbonCountIssue) inconsistencies.push(carbonCountIssue);
  }

  if (question.cosy) {
    const cosyIssue = checkCosyShape(graph, question);
    if (cosyIssue) inconsistencies.push(cosyIssue);
  }

  return inconsistencies;
}

function checkFormula(
  graph: MoleculeGraph,
  question: Question,
): Inconsistency | null {
  const formulaMatches = graph.formula === question.molecularFormula;
  const mwMatches =
    question.molecularWeight == null ||
    Math.abs(graph.molecularWeight - question.molecularWeight) <= 0.2;

  if (formulaMatches && mwMatches) return null;

  const level1 = "分子式・分子量が一致しません。";
  // 分子式を画面に表示していない問題(molecularWeightが設定されている実践問題)では、
  // フィードバックでも分子式そのものは開示しない(表示方針と矛盾させない)。
  const level2 =
    question.molecularWeight != null
      ? `あなたの構造の分子量は約${graph.molecularWeight}ですが、問題の分子量は${question.molecularWeight}です。`
      : `あなたの構造の分子式は${graph.formula}ですが、問題の分子式は${question.molecularFormula}です。`;

  return { method: "formula", level1, level2 };
}

function checkDept(
  graph: MoleculeGraph,
  question: Question,
): Inconsistency | null {
  const dept = question.dept;
  if (!dept) return null;
  const counts = countCarbonTypesByEquivalence(graph);
  if (!counts) return null;

  const expectedCh = dept.dept90.length;
  const expectedChOrCh3 = dept.positive135.length;
  const expectedCh2 = dept.negative135.length;
  const expectedCh3 = expectedChOrCh3 - expectedCh;

  const mismatches: string[] = [];
  if (counts.ch2 !== expectedCh2) {
    mismatches.push(
      `あなたの構造にはCH2がおよそ${counts.ch2}種類の環境がありますが、DEPT-135のnegative signalは${expectedCh2}本です。`,
    );
  }
  if (counts.ch !== expectedCh) {
    mismatches.push(
      `あなたの構造にはCHがおよそ${counts.ch}種類の環境がありますが、DEPT-90のシグナルは${expectedCh}本です。`,
    );
  }
  if (counts.ch3 !== expectedCh3) {
    mismatches.push(
      `あなたの構造にはCH3がおよそ${counts.ch3}種類の環境がありますが、DEPTデータから予想されるCH3は${expectedCh3}本です。`,
    );
  }
  if (question.cNmr && question.cNmr.length > 0) {
    const expectedCq =
      question.cNmr.length - expectedChOrCh3 - expectedCh2;
    if (counts.cq !== expectedCq) {
      mismatches.push(
        `あなたの構造には第四級炭素(Cq)がおよそ${counts.cq}種類の環境がありますが、データから予想される数は${expectedCq}です。`,
      );
    }
  }

  if (mismatches.length === 0) return null;

  return {
    method: "DEPT",
    level1: "DEPTデータと矛盾があります。",
    level2: mismatches.join(" "),
  };
}

function checkCarbonSignalCount(
  graph: MoleculeGraph,
  question: Question,
): Inconsistency | null {
  const expected = question.cNmr?.length ?? 0;
  const actual = countDistinctCarbonEnvironments(graph);
  if (actual === null || actual === expected) return null;
  return {
    method: "13C",
    level1: "¹³C NMRのシグナル数と矛盾があります。",
    level2: `あなたの構造にはおよそ${actual}種類の炭素環境がありますが、¹³C NMRのシグナルは${expected}本です。`,
  };
}

function checkCosyShape(
  graph: MoleculeGraph,
  question: Question,
): Inconsistency | null {
  const cosy = question.cosy;
  if (!cosy) return null;

  const expectedIslands = computeExpectedCosyIslands(question, cosy);
  const actualIslands = computeSpinSystemIslands(graph);
  if (actualIslands === null) return null;

  const expectedMultiIsland = expectedIslands.filter((n) => n > 1);
  const actualMultiIsland = actualIslands.filter((n) => n > 1);

  const same =
    expectedMultiIsland.length === actualMultiIsland.length &&
    expectedMultiIsland.every((n, i) => n === actualMultiIsland[i]);
  if (same) return null;

  return {
    method: "COSY",
    level1: "COSYデータと矛盾があります。",
    level2: `COSYデータは、${describeIslands(expectedMultiIsland)}という独立したスピン系を示していますが、あなたの構造ではプロトンが${describeIslands(actualMultiIsland)}という構成で繋がっています。`,
  };
}

function describeIslands(islands: number[]): string {
  if (islands.length === 0) return "つながりのある";
  return islands.map((n) => `${n}個のプロトンがつながった系`).join("、");
}

function computeExpectedCosyIslands(
  question: Question,
  cosy: NonNullable<Question["cosy"]>,
): number[] {
  const shifts = question.hNmr.map((s) => s.shift);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    return root;
  };
  for (const s of shifts) parent.set(s, s);
  for (const [a, b] of cosy.correlations) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const totals = new Map<string, number>();
  for (const signal of question.hNmr) {
    const root = find(signal.shift);
    totals.set(root, (totals.get(root) ?? 0) + signal.integration);
  }
  return Array.from(totals.values()).sort((a, b) => b - a);
}
