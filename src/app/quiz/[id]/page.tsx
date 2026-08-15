import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuestionById, questions } from "@/data/questions";
import { difficultyLabel } from "@/lib/format";
import QuizView from "@/components/QuizView";

export function generateStaticParams() {
  return questions.map((q) => ({ id: String(q.id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const question = getQuestionById(Number(id));
  if (!question) return {};
  // 化合物名や解説など答えに直結する情報はmetadataに含めない(タブのタイトルや
  // OGPから答えが漏れないようにするため)。
  return {
    title: `問題 ${question.id}(${difficultyLabel(question.difficulty)})`,
    alternates: { canonical: `/quiz/${question.id}` },
  };
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const question = getQuestionById(Number(id));

  if (!question) {
    notFound();
  }

  return <QuizView question={question} />;
}
