/**
 * 貼り付けられたテキストからピークリストを読み取る。
 *
 * ¹³C: 改行・カンマ・セミコロン・空白・タブ区切りで、数値として完全に
 * 解釈できるトークンだけをシフトとして拾う(例: "211.95\n186.58" や
 * "211.95, 186.58")。"CDCl3" や "(125" のような数値でないトークンは無視する。
 *
 * ¹H: 1行1ピーク。行内で最初の数値をシフトとする。積分値は
 * "2H" のような「数字+H」表記を優先し、無ければ2つ目の数値(整数)を使う。
 * どちらも無ければ1とする。例:
 *   "7.26"                  → δ 7.26, 1H
 *   "7.26\t2"               → δ 7.26, 2H (Excelからのコピー)
 *   "7.26 (2H, d, J = 8.0)" → δ 7.26, 2H
 *
 * 外部モジュールに依存しないため、Node単体でテスト可能。
 */

export interface ParsedPeak {
  shift: number;
  integration?: number;
}

const TOKEN_SPLIT = /[\s,;、，；]+/;

function strictNumber(token: string): number | null {
  if (token === "") return null;
  // 全角数字・全角ピリオド・全角マイナスを半角に寄せる
  const normalized = token
    .replace(/[０-９．－]/g, (c) =>
      c === "．" ? "." : c === "－" ? "-" : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[−–]/g, "-");
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(normalized)) return null;
  return Number(normalized);
}

export function parseCarbonList(text: string): ParsedPeak[] {
  return text
    .split(TOKEN_SPLIT)
    .map(strictNumber)
    .filter((n): n is number => n != null)
    .map((shift) => ({ shift }));
}

export function parseProtonList(text: string): ParsedPeak[] {
  const peaks: ParsedPeak[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(TOKEN_SPLIT).filter(Boolean);
    const numbers = tokens.map(strictNumber);
    const shiftIndex = numbers.findIndex((n) => n != null);
    if (shiftIndex < 0) continue;
    const shift = numbers[shiftIndex]!;

    let integration: number | undefined;
    const hMatch = line.match(/(\d+)\s*H\b/);
    if (hMatch) {
      integration = parseInt(hMatch[1], 10);
    } else {
      // "J = 7.0 Hz" のJ値を積分と誤読しないよう、Jより前にある
      // 小数点なしの整数トークンだけを積分とみなす。
      const jIndex = tokens.findIndex((t) => /J/.test(t));
      const end = jIndex < 0 ? tokens.length : jIndex;
      for (let i = shiftIndex + 1; i < end; i++) {
        const n = numbers[i];
        if (n != null) {
          if (/^[0-9０-９]+$/.test(tokens[i]) && n > 0) integration = n;
          break;
        }
      }
    }
    peaks.push({ shift, integration: integration ?? 1 });
  }
  return peaks;
}
