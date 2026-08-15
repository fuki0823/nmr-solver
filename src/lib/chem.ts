import type { ChemicalMimeType, Ketcher } from "ketcher-core";
import { analyzeInconsistencies, type Inconsistency } from "./inconsistency";
import type { Question } from "./types";

// ketcher-core を値としてimportすると(SSR時にNode向けcanvas実装を要求する
// `paper`パッケージ経由で)ビルドが壊れるため、MIMEタイプは文字列定数として
// 直接定義する(値は ketcher-core の ChemicalMimeType と同一。型のみimportして
// キャストすることで ketcher-core の実体は一切バンドルされない)。
const MIME_DAYLIGHT_SMILES = "chemical/x-daylight-smiles" as ChemicalMimeType;
const MIME_INCHI = "chemical/x-inchi" as ChemicalMimeType;

export interface AnswerCheckResult {
  isCorrect: boolean;
  error?: string;
  inconsistencies?: Inconsistency[];
}

function normalizeInchi(inchi: string): string {
  return inchi.trim();
}

/**
 * ユーザーが描いた構造と正解SMILESをInChI(原子の描画順序や番号に依存しない
 * 正規化された識別子)に変換して比較する。同じIndigoエンジンを使うため、
 * 描画順序・SMILES表記の違いによる誤判定を避けられる。
 *
 * 不正解の場合は、提出構造とスペクトルデータを決定論的に比較し、矛盾点
 * (inconsistencies)も併せて返す。この検証はLLMを一切使わない純粋なロジック
 * (inconsistency.ts)で行う。
 */
export async function checkAnswer(
  ketcher: Ketcher,
  question: Question,
): Promise<AnswerCheckResult> {
  let userInchi: string;
  try {
    userInchi = normalizeInchi(await ketcher.getInchi());
  } catch {
    return { isCorrect: false, error: "描かれた構造を認識できませんでした。" };
  }

  if (!userInchi) {
    return { isCorrect: false, error: "まだ構造が描かれていません。" };
  }

  let correctInchi: string;
  try {
    const result = await ketcher.structService.convert({
      struct: question.correctSmiles,
      input_format: MIME_DAYLIGHT_SMILES,
      output_format: MIME_INCHI,
    });
    correctInchi = normalizeInchi(result.struct);
  } catch {
    return { isCorrect: false, error: "正解構造の変換中にエラーが発生しました。" };
  }

  if (userInchi === correctInchi) {
    return { isCorrect: true };
  }

  let inconsistencies: Inconsistency[] = [];
  try {
    const molfile = await ketcher.getMolfile();
    inconsistencies = analyzeInconsistencies(molfile, question);
  } catch {
    inconsistencies = [];
  }

  return { isCorrect: false, inconsistencies };
}

/** 正解構造をPNG画像(data URL)として生成する */
export async function generateStructureImage(
  ketcher: Ketcher,
  smiles: string,
): Promise<string> {
  const base64 = await ketcher.structService.generateImageAsBase64(smiles, {
    outputFormat: "png",
  });
  if (base64.startsWith("data:")) return base64;
  return `data:image/png;base64,${base64}`;
}
