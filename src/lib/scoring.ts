/** ヒントを1つ見るごとの減点(段階的に大きくなる) */
export const HINT_PENALTIES = [10, 15, 20] as const;

export const MAX_SCORE = 100;

// DEPT-90 / DEPT-135 は、構造決定に実質的に必要な情報(第四級炭素の判別など)
// であり、通常の「答えを教えるヒント」とは性質が異なるため減点しない。
export function calculateScore(hintsUsed: number): number {
  const hintPenalty = HINT_PENALTIES.slice(0, hintsUsed).reduce(
    (sum, p) => sum + p,
    0,
  );
  return Math.max(0, MAX_SCORE - hintPenalty);
}

export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
