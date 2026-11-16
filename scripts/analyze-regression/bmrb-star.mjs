// BMRB の NMR-STAR ファイルを読むための共通部品(import-bmrb.mjs / add-multiplicity.mjs で使う)。

export async function fetchBmrbEntry(bmse) {
  const url = `https://bmrb.io/ftp/pub/bmrb/metabolomics/entry_directories/${bmse}/${bmse}.str`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BMRB ${bmse}: HTTP ${res.status}`);
  return parseStar(await res.text());
}

// ---- NMR-STAR の簡易パーサ(saveframe と loop だけを読む) ----
export function tokenize(line) {
  return line.match(/'[^']*'|"[^"]*"|\S+/g)?.map((t) => t.replace(/^['"]|['"]$/g, "")) ?? [];
}
export function parseStar(text) {
  const frames = [];
  let frame = null;
  let pendingTag = null; // 値が次行以降(;...;のテキストブロック)にあるタグ
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith(";")) {
      // 複数行テキスト。直前のタグに値が無ければ、その値として扱う
      const block = [trimmed.slice(1)];
      i++;
      while (i < lines.length && !lines[i].startsWith(";")) block.push(lines[i++]);
      if (frame && pendingTag) frame.tags[pendingTag] = block.join("\n").trim();
      pendingTag = null;
      continue;
    }
    if (trimmed !== "") pendingTag = null;
    if (/^save_\S+/.test(trimmed)) {
      frame = { name: trimmed.slice(5), tags: {}, loops: [] };
      frames.push(frame);
      continue;
    }
    if (trimmed === "save_") {
      frame = null;
      continue;
    }
    if (!frame) continue;
    if (trimmed === "loop_") {
      const loop = { tags: [], rows: [] };
      i++;
      while (i < lines.length && lines[i].trim().startsWith("_")) {
        loop.tags.push(lines[i].trim().split(/\s+/)[0]);
        i++;
      }
      let buffer = [];
      for (; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === "stop_") break;
        if (t === "" || t.startsWith("#")) continue;
        buffer.push(...tokenize(t));
        while (buffer.length >= loop.tags.length) {
          const row = {};
          loop.tags.forEach((tag, k) => (row[tag] = buffer[k]));
          loop.rows.push(row);
          buffer = buffer.slice(loop.tags.length);
        }
      }
      frame.loops.push(loop);
      continue;
    }
    if (trimmed.startsWith("_")) {
      const [tag, ...rest] = tokenize(trimmed);
      frame.tags[tag] = rest.join(" ");
      if (rest.length === 0) pendingTag = tag;
    }
  }
  return frames;
}
export const loopRows = (frames, firstTag) =>
  frames.flatMap((f) => f.loops.filter((l) => l.tags.includes(firstTag)).flatMap((l) => l.rows));


/**
 * 1D ¹H ピークリストの多重度(Coupling_pattern)を、指定したシフトごとに返す。
 * ±0.01 ppm 以内のピークが1つに決まり、多重度が記載されている場合だけ値を返す
 * (決まらなければ undefined)。BMRB の値は s, d, t, q, dd, m などの表記。
 */
export function multiplicitiesFor(frames, shifts, tolerance = 0.01) {
  const peaks = [];
  for (const f of frames) {
    if (!/^1D 1H$/i.test(f.tags["_Spectral_peak_list.Experiment_name"] ?? "")) continue;
    for (const l of f.loops) {
      const pattern = l.tags.find((t) => t.endsWith(".Coupling_pattern"));
      const shift = l.tags.find((t) => t.endsWith(".Chem_shift_val"));
      if (!pattern || !shift) continue;
      for (const r of l.rows) {
        const v = Number(r[shift]);
        const m = (r[pattern] ?? "").trim();
        if (Number.isFinite(v)) peaks.push({ shift: v, multiplicity: m });
      }
    }
  }
  return shifts.map((s) => {
    const hits = peaks.filter((p) => Math.abs(p.shift - s) <= tolerance);
    if (hits.length !== 1) return undefined;
    const m = hits[0].multiplicity.toLowerCase();
    if (!m || m === "?" || m === "." || m === "na") return undefined;
    return m;
  });
}

/**
 * DEPT-90 / DEPT-135 の実測ピークリストから、各 ¹³C シフトの炭素の種類を返す
 * ("C", "CH", "CH2", "CH3", "CH/CH3", "CH2/CH3", "CH/CH2/CH3" または undefined)。
 *  - DEPT-90 に出る → CH
 *  - DEPT-135 で負 → CH2
 *  - DEPT-135 で正(DEPT-90 に出ない) → CH/CH3
 *  - DEPT-135 に出るが強度の符号が無い → CH/CH2/CH3
 *  - DEPT-135 に出ない → 判定しない
 * 「出ていない」ことに基づく推論(DEPT-90 に無いから CH3、DEPT-135 に無いから C)は
 * 使わない。弱いピークの検出漏れで誤判定になり、実際にルチンでは糖の CH を CH3 や C と
 * 判定してしまった(この誤りは DEPT の本数のハード制約で正解を除外する原因になる)。
 * 実データの癖への対処:
 *  - 化学シフトの基準のずれ: DEPT と ¹³C の一覧の間の全体的なずれ(±1 ppm 以内)を、
 *    一致するピーク数が最大になるように推定して補正する(例: ルテオリンは約 -0.25 ppm)。
 *  - 補正しても DEPT-135 のピークの8割以上が ¹³C に対応しなければ、DEPT 全体を使わない
 *    (「出ていない → C」の推論が成り立たないため)。
 *  - 位相の反転: DEPT-90 に出たピーク(CH)が DEPT-135 で負なら、DEPT-135 の符号を反転する。
 *  - DEPT-90 の漏れ込み: 最大強度の3割未満のピークは無視する。強度の記録が無い DEPT-90 は使わない。
 * 同じシフトの炭素が複数ある場合や、結果が矛盾する場合は undefined(判定に使わない)。
 */
export function carbonTypesFor(frames, carbonShifts, tolerance = 0.08) {
  const deptPeaks = (pattern) => {
    const frame = frames.find((f) => pattern.test(f.tags["_Spectral_peak_list.Experiment_name"] ?? ""));
    if (!frame) return null;
    const shifts = new Map();
    const intensities = new Map();
    for (const l of frame.loops) {
      const shiftTag = l.tags.find((t) => t.endsWith(".Chem_shift_val"));
      const intTag = l.tags.find((t) => t.endsWith(".Intensity_val"));
      const idTag =
        l.tags.find((t) => t.endsWith(".Spectral_transition_ID")) ?? l.tags.find((t) => t.endsWith(".Peak_ID"));
      if (!idTag) continue;
      for (const r of l.rows) {
        if (shiftTag && Number.isFinite(Number(r[shiftTag]))) shifts.set(r[idTag], Number(r[shiftTag]));
        if (intTag && Number.isFinite(Number(r[intTag]))) intensities.set(r[idTag], Number(r[intTag]));
      }
    }
    return [...shifts.entries()].map(([id, shift]) => ({
      shift,
      intensity: intensities.has(id) ? intensities.get(id) : null,
    }));
  };
  const none = carbonShifts.map(() => undefined);
  let d90 = deptPeaks(/DEPT\s*-?\s*90/i);
  const d135 = deptPeaks(/DEPT\s*-?\s*135/i);
  if (!d135 || d135.length === 0) return none;

  // DEPT-90 の漏れ込み(CH2/CH3 が弱く残る)の除去。強度の記録が無いと漏れ込みと
  // 本物の CH を区別できない(ニコチンで CH2 を CH と数えてしまった)ため、その場合は
  // DEPT-90 を使わない。
  if (d90 && d90.every((p) => p.intensity != null)) {
    const max = Math.max(...d90.map((p) => Math.abs(p.intensity)));
    d90 = d90.filter((p) => Math.abs(p.intensity) >= 0.3 * max);
  } else {
    d90 = null;
  }

  // 全体的なずれの推定(0.01 ppm 刻み)
  const countMatched = (peaks, offset) =>
    peaks.filter((p) => carbonShifts.some((c) => Math.abs(c - (p.shift + offset)) <= tolerance)).length;
  let offset = 0;
  let bestCount = -1;
  for (let k = -100; k <= 100; k++) {
    const o = k / 100;
    const n = countMatched(d135, o);
    if (n > bestCount || (n === bestCount && Math.abs(o) < Math.abs(offset))) [offset, bestCount] = [o, n];
  }
  if (bestCount < 0.8 * d135.length) return none;

  const nearest = (s) => {
    let best = -1;
    let bestD = Infinity;
    carbonShifts.forEach((c, i) => {
      const d = Math.abs(c - (s + offset));
      if (d < bestD) [best, bestD] = [i, d];
    });
    return bestD <= tolerance ? best : -1;
  };
  const hits90 = carbonShifts.map(() => []);
  const hits135 = carbonShifts.map(() => []);
  for (const p of d90 ?? []) {
    const i = nearest(p.shift);
    if (i >= 0) hits90[i].push(p);
  }
  for (const p of d135) {
    const i = nearest(p.shift);
    if (i >= 0) hits135[i].push(p);
  }

  // 位相の確認: CH(DEPT-90 に出たもの)は DEPT-135 で正のはず
  const chSigns = carbonShifts
    .map((_, i) => (hits90[i].length && hits135[i].length ? Math.sign(hits135[i][0].intensity ?? 0) : 0))
    .filter((x) => x !== 0);
  const flip = chSigns.length > 0 && chSigns.filter((x) => x < 0).length > chSigns.length / 2 ? -1 : 1;

  return carbonShifts.map((s, i) => {
    if (carbonShifts.filter((x) => x === s).length > 1) return undefined; // 重なった炭素
    const signs = new Set(hits135[i].map((p) => (p.intensity == null ? null : Math.sign(p.intensity) * flip)));
    if (signs.size > 1) return undefined;
    const sign = hits135[i].length ? [...signs][0] : undefined;
    if (hits90[i].length > 0) return sign === -1 ? undefined : "CH";
    if (hits135[i].length === 0) return undefined;
    if (sign === -1) return "CH2";
    if (sign === 1) return "CH/CH3";
    return "CH/CH2/CH3";
  });
}
