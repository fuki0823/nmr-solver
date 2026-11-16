import { parseCarbonType } from "./dept";

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
  /** ¹Hのみ: 多重度("s", "d", "dd", "br s" など)。行中に見つからなければ undefined */
  multiplicity?: string;
  /** ¹³Cのみ: DEPT 等の炭素の種類("C", "CH", "CH2", "CH3", "CH/CH3" など) */
  carbonType?: string;
}

const MULTIPLICITY_TOKEN = /^(s|d|t|q|m|p|dd|dt|td|tt|dq|qd|ddd|ddt|dddd|quint|quin|pent|sext|sept|hept)$/i;

/** 行から多重度を探す(例: "7.26 (2H, d, J = 8.0 Hz)" → "d"、"3.5 (br s, 1H)" → "br s") */
function findMultiplicity(line: string): string | undefined {
  const words = line
    .replace(/J\s*=.*$/, "") // J値以降は見ない
    .split(/[\s,;、，；()（）]+/)
    .map((w) => w.replace(/\.$/, "").trim())
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if ((w === "br" || w === "brs") && i + 1 < words.length && MULTIPLICITY_TOKEN.test(words[i + 1])) {
      return `br ${words[i + 1].toLowerCase()}`;
    }
    if (w === "brs") return "br s";
    if (MULTIPLICITY_TOKEN.test(w)) return w;
  }
  return undefined;
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

/**
 * ¹³C: 数値の直後に炭素の種類の表記があれば、そのピークの種類として読む
 * (例: "211.95 (C)", "75.0 CH", "56.6(CH3)", "35.9 t")。
 * "(125 MHz" のように括弧が付いた数値はこれまで通りピークとして扱わない。
 */
export function parseCarbonList(text: string): ParsedPeak[] {
  const tokens = text.split(TOKEN_SPLIT).filter(Boolean);
  const peaks: ParsedPeak[] = [];
  const typeOf = (token: string | undefined) => {
    if (!token) return undefined;
    const stripped = token.replace(/^[(（]+|[)）]+$/g, "");
    return parseCarbonType(stripped) ? stripped : undefined;
  };
  for (let i = 0; i < tokens.length; i++) {
    const n = strictNumber(tokens[i]);
    if (n != null) {
      const type = typeOf(tokens[i + 1]);
      if (type) i++;
      peaks.push(type ? { shift: n, carbonType: type } : { shift: n });
      continue;
    }
    // "56.6(CH3)" のように数値と種類が続けて書かれている場合
    const glued = tokens[i].match(/^(\d+(?:\.\d+)?)[(（]([^)）]+)[)）]$/);
    if (glued && parseCarbonType(glued[2])) peaks.push({ shift: Number(glued[1]), carbonType: glued[2] });
  }
  return peaks;
}

/** "5.13-5.01" のような範囲表記なら中央値を返す(重なった多重線の記載でよく使われる) */
function rangeMidpoint(token: string): number | null {
  const m = token.match(/^(\d+(?:\.\d+)?)\s*[-–−~〜]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const mid = (Number(m[1]) + Number(m[2])) / 2;
  return Math.round(mid * 1000) / 1000;
}

export function parseProtonList(text: string): ParsedPeak[] {
  const peaks: ParsedPeak[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(TOKEN_SPLIT).filter(Boolean);
    const numbers = tokens.map(strictNumber);
    const shiftIndex = tokens.findIndex((t, i) => numbers[i] != null || rangeMidpoint(t) != null);
    if (shiftIndex < 0) continue;
    const shift = numbers[shiftIndex] ?? rangeMidpoint(tokens[shiftIndex])!;

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
    peaks.push({ shift, integration: integration ?? 1, multiplicity: findMultiplicity(line) });
  }
  return peaks;
}
