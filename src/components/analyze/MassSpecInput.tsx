"use client";

import type { MassSpecData } from "@/lib/analyze/types";
import { ADDUCT_MASS_DELTA, OPTIONAL_ELEMENTS } from "@/lib/analyze/formula/massToFormulaCandidates";

interface MassSpecInputProps {
  value: MassSpecData;
  onChange: (value: MassSpecData) => void;
}

const ADDUCTS = Object.keys(ADDUCT_MASS_DELTA);

const ELEMENT_HINT: Record<string, string> = {
  Cl: "M+2 が M の約1/3(Cl 1個)",
  Br: "M+2 が M とほぼ同じ強さ(Br 1個)",
  F: "¹⁹F NMR 等で確認",
  I: "質量欠損が大きい",
  P: "³¹P NMR 等で確認",
};

export default function MassSpecInput({ value, onChange }: MassSpecInputProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm text-stone-700">
        測定 m/z
        <input
          type="number"
          step="0.0001"
          value={value.measuredMz ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              measuredMz: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          className="rounded border border-stone-300 px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-stone-700">
        イオン/アダクト
        <select
          value={value.ionAdduct ?? ""}
          onChange={(e) => onChange({ ...value, ionAdduct: e.target.value || undefined })}
          className="rounded border border-stone-300 px-2 py-1.5"
        >
          <option value="">(未選択)</option>
          {ADDUCTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-stone-700">
        Molecular Weight(概算のみの場合)
        <input
          type="number"
          step="0.01"
          value={value.molecularWeight ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              molecularWeight: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          className="rounded border border-stone-300 px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-stone-700">
        質量許容誤差 (ppm、既定10)
        <input
          type="number"
          value={value.massTolerancePpm ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              massTolerancePpm: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          disabled={value.massToleranceDa != null}
          className="rounded border border-stone-300 px-2 py-1.5 disabled:bg-stone-100 disabled:text-stone-400"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-stone-700">
        質量許容誤差 (Da絶対値、低分解能MS向け)
        <input
          type="number"
          step="0.01"
          placeholder="例: 0.1(単位質量分解能の機器等)"
          value={value.massToleranceDa ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              massToleranceDa: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          className="rounded border border-stone-300 px-2 py-1.5"
        />
        <span className="text-xs text-stone-500">
          入力するとppm指定より優先されます。精密質量(HRMS)が無い場合のみ使用してください。
        </span>
      </label>
      <fieldset className="flex flex-col gap-2 text-sm text-stone-700 sm:col-span-2">
        <legend className="mb-1">C・H・N・O・S 以外に含まれうる元素</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {OPTIONAL_ELEMENTS.map((el) => {
            const checked = value.elements?.includes(el) ?? false;
            return (
              <label key={el} className="flex items-center gap-1.5" title={ELEMENT_HINT[el]}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(value.elements ?? []);
                    if (e.target.checked) next.add(el);
                    else next.delete(el);
                    onChange({ ...value, elements: next.size ? [...next] : undefined });
                  }}
                />
                {el}
              </label>
            );
          })}
        </div>
        <span className="text-xs text-stone-500">
          チェックした元素だけを分子式の探索に加えます。Cl・Br は MS の同位体パターン(Cl: M+2 が M の約1/3、Br: M+2 が M とほぼ同じ)で判断できます。不要な元素まで加えると候補が大幅に増え、探索にも時間がかかります。
        </span>
      </fieldset>
    </div>
  );
}
