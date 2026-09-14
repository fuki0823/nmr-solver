"use client";

import type { MassSpecData } from "@/lib/analyze/types";
import { ADDUCT_MASS_DELTA } from "@/lib/analyze/formula/massToFormulaCandidates";

interface MassSpecInputProps {
  value: MassSpecData;
  onChange: (value: MassSpecData) => void;
}

const ADDUCTS = Object.keys(ADDUCT_MASS_DELTA);

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
        Exact Mass(分かっていれば直接入力)
        <input
          type="number"
          step="0.0001"
          value={value.exactMass ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              exactMass: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          className="rounded border border-stone-300 px-2 py-1.5"
        />
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
          className="rounded border border-stone-300 px-2 py-1.5"
        />
      </label>
    </div>
  );
}
