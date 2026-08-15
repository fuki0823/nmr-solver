"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { track } from "@vercel/analytics";
import type { Ketcher } from "ketcher-core";
import type { Question } from "@/lib/types";
import { checkAnswer, generateStructureImage } from "@/lib/chem";
import type { Inconsistency } from "@/lib/inconsistency";
import {
  HINT_PENALTIES,
  calculateScore,
  formatElapsedTime,
} from "@/lib/scoring";
import { difficultyLabel, formatHNmrSignal, formatMass } from "@/lib/format";
import MolecularFormula from "./MolecularFormula";

const StructureEditor = dynamic(() => import("./StructureEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] w-full items-center justify-center rounded-lg border border-stone-300 bg-stone-50 text-sm text-stone-700">
      構造エディタを読み込んでいます…
    </div>
  ),
});

interface QuizViewProps {
  question: Question;
}

export default function QuizView({ question }: QuizViewProps) {
  const ketcherRef = useRef<Ketcher | null>(null);
  const startTimeRef = useRef<number>(0);

  const [editorReady, setEditorReady] = useState(false);
  const [editorSlow, setEditorSlow] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [inconsistencies, setInconsistencies] = useState<Inconsistency[]>([]);
  const [expandedInconsistencies, setExpandedInconsistencies] = useState<
    Set<number>
  >(new Set());

  const [solved, setSolved] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [finalElapsedMs, setFinalElapsedMs] = useState(0);
  const [correctImage, setCorrectImage] = useState<string | null>(null);
  const finished = solved || gaveUp;

  // レンダー中に Date.now() を呼ぶのは purity ルールに反するため、
  // マウント時の副作用として計測開始時刻を記録する。
  useEffect(() => {
    startTimeRef.current = Date.now();
  }, []);

  // 計測: 問題番号・難易度・正誤・使用ヒント数のみを送信する。ユーザーが
  // 描いた構造そのものなど、個人が特定されうる情報や不要な情報は送らない。
  useEffect(() => {
    track("problem_start", {
      questionId: question.id,
      difficulty: question.difficulty,
    });
  }, [question.id, question.difficulty]);

  useEffect(() => {
    if (finished) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [finished]);

  // 構造エディタの初期化(WASMの読み込み)が極端に遅い・失敗した場合、
  // ボタンが押せないまま無言で固まって見えないよう、案内メッセージを出す。
  useEffect(() => {
    if (editorReady) return;
    const timer = setTimeout(() => setEditorSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [editorReady]);

  const score = useMemo(
    () => (gaveUp ? 0 : calculateScore(hintsUsed)),
    [gaveUp, hintsUsed],
  );

  const handleReady = useCallback((ketcher: Ketcher) => {
    ketcherRef.current = ketcher;
    setEditorReady(true);
  }, []);

  const handleShowHint = () => {
    setHintsUsed((h) => Math.min(h + 1, question.hints.length));
  };

  const handleSubmit = async () => {
    const ketcher = ketcherRef.current;
    if (!ketcher || checking) return;
    setChecking(true);
    setFeedback(null);
    setInconsistencies([]);
    setExpandedInconsistencies(new Set());
    try {
      const result = await checkAnswer(ketcher, question);
      track("answer_submitted", {
        questionId: question.id,
        correct: result.isCorrect,
      });
      if (result.isCorrect) {
        const finalMs = Date.now() - startTimeRef.current;
        setFinalElapsedMs(finalMs);
        setSolved(true);
        track("problem_completed", {
          questionId: question.id,
          result: "solved",
          hintsUsed,
        });
        try {
          const image = await generateStructureImage(
            ketcher,
            question.correctSmiles,
          );
          setCorrectImage(image);
        } catch {
          setCorrectImage(null);
        }
      } else {
        setFeedback(
          result.error ?? "不正解です。もう一度構造を確認してみましょう。",
        );
        setInconsistencies(result.inconsistencies ?? []);
      }
    } finally {
      setChecking(false);
    }
  };

  const toggleInconsistencyDetail = (index: number) => {
    setExpandedInconsistencies((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleShowAnswer = async () => {
    const finalMs = Date.now() - startTimeRef.current;
    setFinalElapsedMs(finalMs);
    setGaveUp(true);
    track("problem_completed", {
      questionId: question.id,
      result: "gave_up",
      hintsUsed,
    });
    const ketcher = ketcherRef.current;
    if (!ketcher) return;
    try {
      const image = await generateStructureImage(ketcher, question.correctSmiles);
      setCorrectImage(image);
    } catch {
      setCorrectImage(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-stone-700 transition-colors hover:text-stone-900"
          >
            ← 問題一覧
          </Link>
          <h1 className="text-lg font-semibold text-stone-900">
            問題 {question.id}
          </h1>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
            {difficultyLabel(question.difficulty)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-stone-700">
          <span>
            経過時間 {formatElapsedTime(finished ? finalElapsedMs : elapsedMs)}
          </span>
          <span>得点 {score}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          {question.molecularWeight != null ? (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                分子量
              </h2>
              <p className="font-mono text-xl text-stone-900">
                {formatMass(question.molecularWeight, 1)}
              </p>
              {question.exactMass != null && (
                <p className="mt-1 font-mono text-sm text-stone-700">
                  Exact Mass {formatMass(question.exactMass, 4)}
                </p>
              )}
            </section>
          ) : (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                分子式
              </h2>
              <MolecularFormula
                formula={question.molecularFormula}
                className="font-mono text-xl text-stone-900"
              />
            </section>
          )}

          <section className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
              ¹H NMR
            </h2>
            <ul className="flex flex-col gap-1 font-mono text-sm text-stone-800">
              {question.hNmr.map((signal, i) => (
                <li key={i}>{formatHNmrSignal(signal)}</li>
              ))}
            </ul>
          </section>

          {question.cNmr && question.cNmr.length > 0 && (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                ¹³C NMR
              </h2>
              <p className="font-mono text-sm text-stone-800">
                δ {question.cNmr.map((c) => c.shift).join(", ")}
              </p>
            </section>
          )}

          {question.dept && (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                    DEPT-90
                  </h2>
                  <p className="font-mono text-sm text-stone-800">
                    δ{" "}
                    {question.dept.dept90.length > 0
                      ? question.dept.dept90.join(", ")
                      : "(ピークなし)"}
                  </p>
                </div>
                <div>
                  <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                    DEPT-135
                  </h2>
                  <div className="flex flex-col gap-1 font-mono text-sm text-stone-800">
                    <p>
                      positive: δ{" "}
                      {question.dept.positive135.length > 0
                        ? question.dept.positive135.join(", ")
                        : "(ピークなし)"}
                    </p>
                    <p>
                      negative: δ{" "}
                      {question.dept.negative135.length > 0
                        ? question.dept.negative135.join(", ")
                        : "(ピークなし)"}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {question.cosy && (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                ¹H-¹H COSY
              </h2>
              <ul className="flex flex-col gap-1 font-mono text-sm text-stone-800">
                {question.cosy.correlations.map(([a, b], i) => (
                  <li key={i}>
                    δH {a} ↔ δH {b}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {question.hsqc && question.hsqc.length > 0 && (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                HSQC
              </h2>
              <ul className="flex flex-col gap-1 font-mono text-sm text-stone-800">
                {question.hsqc.map((corr, i) => (
                  <li key={i}>
                    δH {corr.h} ↔ δC {corr.c}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {question.hmbc && question.hmbc.length > 0 && (
            <section className="rounded-lg border border-stone-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
                HMBC
              </h2>
              <ul className="flex flex-col gap-1 font-mono text-sm text-stone-800">
                {question.hmbc.map((corr, i) => (
                  <li key={i}>
                    δH {corr.h} → δC {corr.c.join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
                ヒント
              </h2>
              {hintsUsed < question.hints.length && !finished && (
                <button
                  type="button"
                  onClick={handleShowHint}
                  className="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
                >
                  ヒントを見る (−{HINT_PENALTIES[hintsUsed]}点)
                </button>
              )}
            </div>
            {hintsUsed === 0 ? (
              <p className="text-sm text-stone-600">
                まだヒントは使用していません。
              </p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm text-stone-700">
                {question.hints.slice(0, hintsUsed).map((hint, i) => (
                  <li key={i}>
                    <span className="font-medium text-stone-700">
                      ヒント{i + 1}:{" "}
                    </span>
                    {hint}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {!finished ? (
            <>
              <StructureEditor onReady={handleReady} />
              {editorSlow && !editorReady && (
                <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  構造エディタの読み込みに時間がかかっています。改善しない場合はページを再読み込みしてください。
                </p>
              )}
              {feedback && (
                <div className="flex flex-col gap-3 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p>{feedback}</p>
                  {inconsistencies.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-amber-200 pt-3">
                      <p className="text-xs font-semibold tracking-wide text-amber-700 uppercase">
                        構造とスペクトルデータの矛盾点
                      </p>
                      <ul className="flex flex-col gap-2">
                        {inconsistencies.map((inc, i) => (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => toggleInconsistencyDetail(i)}
                              className="text-left font-medium text-amber-900 underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
                            >
                              {inc.level1}
                            </button>
                            {expandedInconsistencies.has(i) && (
                              <p className="mt-1 text-amber-800">
                                {inc.level2}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!editorReady || checking}
                  className="self-start rounded-md bg-stone-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {checking ? "判定中…" : "回答する"}
                </button>
                <button
                  type="button"
                  onClick={handleShowAnswer}
                  disabled={!editorReady || checking}
                  className="self-start rounded-md border border-stone-300 px-6 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  答えを見る
                </button>
              </div>
            </>
          ) : (
            <ResultsPanel
              question={question}
              score={score}
              elapsedMs={finalElapsedMs}
              hintsUsed={hintsUsed}
              correctImage={correctImage}
              gaveUp={gaveUp}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultsPanel({
  question,
  score,
  elapsedMs,
  hintsUsed,
  correctImage,
  gaveUp,
}: {
  question: Question;
  score: number;
  elapsedMs: number;
  hintsUsed: number;
  correctImage: string | null;
  gaveUp: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-4 rounded-lg border p-5 ${
        gaveUp
          ? "border-stone-200 bg-stone-50"
          : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div>
        <p
          className={`text-sm font-semibold ${
            gaveUp ? "text-stone-700" : "text-emerald-700"
          }`}
        >
          {gaveUp ? "正解" : "正解です"}
        </p>
        <p className="text-lg font-medium text-stone-900">
          {question.compoundName}
        </p>
      </div>

      <div className="flex items-center justify-center rounded-md border border-stone-200 bg-white p-4">
        {correctImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={correctImage}
            alt={question.compoundName}
            className="max-h-48"
          />
        ) : (
          <p className="text-sm text-stone-600">
            構造画像を生成できませんでした
          </p>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-md bg-white p-3">
          <dt className="text-xs text-stone-600">経過時間</dt>
          <dd className="mt-1 font-mono text-base text-stone-900">
            {formatElapsedTime(elapsedMs)}
          </dd>
        </div>
        <div className="rounded-md bg-white p-3">
          <dt className="text-xs text-stone-600">使用ヒント数</dt>
          <dd className="mt-1 font-mono text-base text-stone-900">
            {hintsUsed}
          </dd>
        </div>
        <div className="rounded-md bg-white p-3">
          <dt className="text-xs text-stone-600">得点</dt>
          <dd className="mt-1 font-mono text-base text-stone-900">{score}</dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-stone-600 uppercase">
          解説
        </h3>
        <p className="text-sm leading-relaxed text-stone-700">
          {question.explanation}
        </p>
      </div>

      <Link
        href="/"
        className="self-start rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
      >
        問題一覧に戻る
      </Link>
    </div>
  );
}
