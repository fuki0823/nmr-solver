import type { ChemicalMimeType, StructService } from "ketcher-core";
import { buildMoleculeGraph, type MoleculeGraph } from "../moleculeGraph";

/**
 * Ketcherの構造エディタ(Editor コンポーネント)を画面に表示せずに、
 * SMILES↔molfile変換だけを行うための「ヘッドレス」なstructService。
 *
 * `ketcher-standalone` の `StandaloneStructServiceProvider.createStructService()`
 * はEditorをマウントしなくても呼び出せるため、Analyzeモードの候補構造の
 * 分子式/MW/グラフ計算に、Ketcherの全UIを読み込む必要はない。
 *
 * ただし `ketcher-standalone`/`ketcher-core` を静的importすると、SSR時に
 * `paper`(Node非対応の依存)を巻き込みビルドが壊れることが分かっている
 * (`lib/chem.ts` 参照)。そのため、この関数は必ずクライアント側の
 * イベントハンドラ/エフェクト内から動的importで呼び出すこと。
 */

const MIME_DAYLIGHT_SMILES = "chemical/x-daylight-smiles" as ChemicalMimeType;
const MIME_MOLFILE = "chemical/x-mdl-molfile" as ChemicalMimeType;

let structServicePromise: Promise<StructService> | null = null;

async function getStructService(): Promise<StructService> {
  if (!structServicePromise) {
    structServicePromise = (async () => {
      const { StandaloneStructServiceProvider } = await import(
        "ketcher-standalone"
      );
      const provider = new StandaloneStructServiceProvider();
      return provider.createStructService({});
    })();
  }
  return structServicePromise;
}

// structServiceの実体は単一のWASM workerであり、大量のリクエストを一斉に
// 投げると詰まって極端に遅くなる(候補25件をPromise.allで並列変換した際に
// 実測で確認済み)。呼び出し元がいくつあっても、ここで確実に1件ずつ順番に
// 処理されるようにする(単純なPromiseチェーンによるキュー)。
let requestQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(task);
  requestQueue = result.catch(() => undefined);
  return result;
}

/** SMILESを検証しつつ、分子式/MW/構造グラフを計算する */
export async function analyzeSmiles(smiles: string): Promise<MoleculeGraph> {
  return enqueue(async () => {
    const structService = await getStructService();
    const result = await structService.convert({
      struct: smiles,
      input_format: MIME_DAYLIGHT_SMILES,
      output_format: MIME_MOLFILE,
    });
    return buildMoleculeGraph(result.struct);
  });
}

/** 構造画像(PNG data URL)を生成する。候補一覧での表示に使う */
export async function generateCandidateImage(smiles: string): Promise<string> {
  return enqueue(async () => {
    const structService = await getStructService();
    const base64 = await structService.generateImageAsBase64(smiles, {
      outputFormat: "png",
    });
    if (base64.startsWith("data:")) return base64;
    return `data:image/png;base64,${base64}`;
  });
}
