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

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">
            Candidate {rank} — {evaluation.candidate.name ?? evaluation.candidate.molecularFormula}
          </p>
          <p className="font-mono text-xs text-stone-600">
            {evaluation.candidate.molecularFormula} / MW {evaluation.candidate.molecularWeight}
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
