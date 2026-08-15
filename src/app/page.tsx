import Link from "next/link";
import { questions } from "@/data/questions";
import { difficultyLabel, formatMass, getQuestionMethods } from "@/lib/format";
import MolecularFormula from "@/components/MolecularFormula";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">
          NMR Solver
        </h1>
        <p className="text-sm text-stone-700">
          分子式とNMRデータ(¹H・¹³C・DEPT・COSY・HSQC・HMBCなど)をもとに構造式を推定し、構造エディタで描いて回答してください。
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {questions.map((q) => (
          <li key={q.id}>
            <Link
              href={`/quiz/${q.id}`}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-5 py-4 transition-colors hover:border-stone-400 hover:bg-stone-50"
            >
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-stone-900">
                  問題 {q.id}
                </span>
                {q.molecularWeight != null ? (
                  <span className="font-mono text-sm text-stone-700">
                    MW {formatMass(q.molecularWeight, 1)}
                    {q.exactMass != null &&
                      ` (Exact Mass ${formatMass(q.exactMass, 4)})`}
                  </span>
                ) : (
                  <MolecularFormula
                    formula={q.molecularFormula}
                    className="font-mono text-sm text-stone-700"
                  />
                )}
                <div className="flex flex-wrap gap-1">
                  {getQuestionMethods(q).map((m) => (
                    <span
                      key={m}
                      className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-700"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-700">
                {difficultyLabel(q.difficulty)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
