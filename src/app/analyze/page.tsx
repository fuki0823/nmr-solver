import type { Metadata } from "next";
import AnalyzeViewLoader from "@/components/analyze/AnalyzeViewLoader";

export const metadata: Metadata = {
  title: "Analyze",
};

export default function AnalyzePage() {
  return <AnalyzeViewLoader />;
}
