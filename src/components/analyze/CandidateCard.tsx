"use client";

import { useEffect, useState } from "react";
import type { CandidateEvaluation } from "@/lib/analyze/scoring/rankCandidates";
import { generateCandidateImage } from "@/lib/analyze/ketcherService";

const STATUS_ICON: Record<string, string> = {
  match: "✓",
  partial: "△",
  mismatch: "✕",
  not_evaluated: "―",
};

const STATUS_COLOR: Record<string, string> = {
  match: "text-emerald-700",
  partial: "text-amber-700",
  mismatch: "text-red-700",
  not_evaluated: "text-stone-400",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  low: "確信度: 低",
  medium: "確信度: 中",
  high: "確信度: 高",
};

/** ハード制約(明らかな矛盾があれば候補を除外しうる)判定を行う手法 */
const HARD_CONSTRAINT_METHODS = ["13C", "HSQC", "HMBC"] as const;

interface CandidateCardProps {
  rank: number;
  evaluation: CandidateEvaluation;
}

export default function CandidateCard({ rank, evaluation }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    generateCandidateImage(evaluation.candidate.smiles)
      .then((img) => {
        if (!cancelled) setImage(img);
      })
      .catch(() => {
        if (!cancelled) setImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [evaluation.candidate.smiles]);

  const { candidate } = evaluation;

  const hardChecks = HARD_CONSTRAINT_METHODS.map((method) => {
    const result = evaluation.results.find((r) => r.method === method);
    const violations = result?.details.filter((d) => d.hardConstraint && d.status === "mismatch") ?? [];
    return {
      method,
      evaluated: !!result && result.status !== "not_evaluated",
      violations,
    };
  });

  return (
    <div
      className={`rounded-lg border p-5 ${
        evaluation.excluded ? "border-red-200 bg-red-50/40" : "border-stone-200 bg-white"
      }`}
    >
      {evaluation.excluded && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-semibold">
            この候補はハード制約(¹³C炭素数・HSQC・HMBCの観測データとの明らかな矛盾)により除外されました。
          </p>
          <ul className="mt-1 list-disc pl-4">
            {evaluation.exclusionReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">
            Candidate {rank} — {candidate.name ?? candidate.molecularFormula}
            <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-stone-500 uppercase">
              {candidate.source}
            </span>
            {evaluation.excluded && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-red-700 uppercase">
                除外
              </span>
            )}
          </p>
          <p className="font-mono text-xs text-stone-600">
            {candidate.molecularFormula} / MW {candidate.molecularWeight}
            {candidate.databaseUrl && (
              <>
                {" "}
                ·{" "}
                <a
                  href={candidate.databaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-stone-300 underline-offset-2 hover:text-stone-900"
                >
                  データベースで見る
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono text-stone-900">Match Score {evaluation.totalScore}</span>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600">
            {CONFIDENCE_LABEL[evaluation.confidence]}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={evaluation.candidate.name ?? "candidate structure"} className="max-h-32" />
        )}
        <div className="flex flex-col gap-2">
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
              Hard constraints(¹³C数・HSQC・HMBC)
            </p>
            <div className="flex flex-wrap gap-2">
              {hardChecks.map((c) => (
                <span
                  key={c.method}
                  title={c.violations.map((v) => v.summary).join("\n") || undefined}
                  className={`rounded border px-2 py-1 text-xs font-medium ${
                    !c.evaluated
                      ? "border-stone-200 text-stone-400"
                      : c.violations.length > 0
                        ? "border-red-200 text-red-700"
                        : "border-emerald-200 text-emerald-700"
                  }`}
                >
                  {c.method} {!c.evaluated ? "―" : c.violations.length > 0 ? "✕" : "✓"}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
              Soft scores(全手法の一致度)
            </p>
            <div className="flex flex-wrap gap-2">
              {evaluation.results
                .filter((r) => r.status !== "not_evaluated" || r.details.length > 0)
                .map((r) => (
                  <span
                    key={r.method}
                    className={`rounded border border-stone-200 px-2 py-1 text-xs font-medium ${STATUS_COLOR[r.status]}`}
                  >
                    {r.method} {STATUS_ICON[r.status]}
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-3 text-xs font-medium text-stone-600 underline decoration-stone-300 underline-offset-2 hover:text-stone-900"
      >
        {expanded ? "詳細を閉じる" : "詳細を見る"}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-stone-100 pt-3">
          {evaluation.results.map((r) => (
            <div key={r.method}>
              <p className={`text-xs font-semibold uppercase ${STATUS_COLOR[r.status]}`}>
                {r.method}: {STATUS_ICON[r.status]}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-stone-700">
                {r.details.map((d, i) => (
                  <li key={i}>
                    <span className={STATUS_COLOR[d.status]}>{STATUS_ICON[d.status]}</span> {d.summary}
                    {d.hardConstraint && (
                      <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[9px] font-semibold text-red-700 uppercase">
                        Hard
                      </span>
                    )}
                  </li>
                ))}
                {r.details.length === 0 && (
                  <li className="text-stone-400">この手法のデータは入力されていません。</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
