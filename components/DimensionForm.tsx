"use client";

import { RoofDimensions, RoofType } from "@/lib/roofGeometry";

const ROOF_TYPES: RoofType[] = ["gable", "hip", "shed", "gambrel"];

export default function DimensionForm({
  value,
  onChange,
}: {
  value: RoofDimensions;
  onChange: (next: RoofDimensions) => void;
}) {
  const set = <K extends keyof RoofDimensions>(key: K, v: RoofDimensions[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="grid grid-cols-4 gap-3">
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
          Roof type
        </label>
        <select
          className="w-full border border-neutral-200 rounded-md px-2 py-2 text-sm bg-neutral-50"
          value={value.roofType}
          onChange={(e) => set("roofType", e.target.value as RoofType)}
        >
          {ROOF_TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <NumberField
        label="Span (m)"
        value={value.spanM}
        onChange={(v) => set("spanM", v)}
        min={1}
        step={0.1}
      />
      <NumberField
        label="Ridge length (m)"
        value={value.ridgeLengthM}
        onChange={(v) => set("ridgeLengthM", v)}
        min={1}
        step={0.1}
      />
      <NumberField
        label="Pitch (°)"
        value={value.pitchDeg}
        onChange={(v) => set("pitchDeg", v)}
        min={1}
        max={75}
        step={1}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
        {label}
      </label>
      <input
        type="number"
        className="w-full border border-neutral-200 rounded-md px-2 py-2 text-sm font-mono bg-neutral-50"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </div>
  );
}
