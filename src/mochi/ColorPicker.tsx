import { useEffect, useMemo, useState } from "react";
import { useTranslation as useUiTranslation } from "../compat/i18n";
import {
  buildMochiCustomTokens,
  hexToHsl,
  hslToHex,
  normalizeHexColor,
  type MochiCustomThemeMode,
} from "./color";

interface MochiColorPickerProps {
  hex: string;
  mode: MochiCustomThemeMode;
  onChange: (hex: string) => void;
}

const PREVIEW_TOKENS = ["--screen", "--tile-a", "--tile-b", "--paper", "--acc"] as const;

/** Inline picker styled with Mochi OS tokens; it never opens a native dialog. */
export function MochiColorPicker({ hex, mode, onChange }: MochiColorPickerProps) {
  const { t: localizeUi } = useUiTranslation();
  const hsl = useMemo(() => hexToHsl(hex), [hex]);
  const tokens = useMemo(() => buildMochiCustomTokens(hex, mode), [hex, mode]);
  const [hueDraft, setHueDraft] = useState(() => String(Math.round(hsl.h)));
  const [hexDraft, setHexDraft] = useState(hex);

  useEffect(() => {
    setHueDraft(String(Math.round(hexToHsl(hex).h)));
    setHexDraft(hex);
  }, [hex]);

  const emitHsl = (next: { h?: number; s?: number; l?: number }) => {
    onChange(
      hslToHex({
        h: next.h ?? hsl.h,
        s: next.s ?? hsl.s,
        l: next.l ?? hsl.l,
      }),
    );
  };

  const saturationPercent = Math.round(hsl.s * 100);
  const lightnessPercent = Math.round(hsl.l * 100);
  const hueValue = Number(hueDraft) || 0;

  return (
    <div className="mochi-color-editor">
      <div className="mochi-color-identity">
        <span
          className="mochi-color-swatch"
          style={{ background: tokens["--acc"] }}
          role="img"
          aria-label={localizeUi("ui.chat.mochiosview.customColorValue", { value1: hex })}
        />
        <label className="mochi-color-hex-field">
          <span>{localizeUi("ui.chat.mochiosview.hexColor")}</span>
          <input
            type="text"
            className="mochi-color-hex"
            value={hexDraft}
            spellCheck={false}
            maxLength={7}
            onChange={(event) => {
              const next = event.target.value;
              setHexDraft(next);
              const normalized = normalizeHexColor(next);
              if (normalized) onChange(normalized);
            }}
            onBlur={() => setHexDraft(hex)}
          />
        </label>
      </div>

      <label className="mochi-color-field">
        <span className="mochi-color-field-label">
          {localizeUi("ui.ui.colorpicker.hue")}
          <output>{hueValue}°</output>
        </span>
        <input
          type="range"
          min={0}
          max={359}
          value={hueDraft}
          aria-label={localizeUi("ui.ui.colorpicker.hue")}
          onChange={(event) => {
            const nextHue = Number(event.target.value);
            setHueDraft(String(nextHue));
            emitHsl({ h: nextHue });
          }}
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
        />
      </label>

      <label className="mochi-color-field">
        <span className="mochi-color-field-label">
          {localizeUi("ui.ui.colorpicker.saturation")}
          <output>{saturationPercent}%</output>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={saturationPercent}
          aria-label={localizeUi("ui.ui.colorpicker.saturation")}
          onChange={(event) => emitHsl({ s: Number(event.target.value) / 100 })}
          style={{
            background: `linear-gradient(to right, hsl(${hsl.h} 0% 50%), hsl(${hsl.h} 100% 50%))`,
          }}
        />
      </label>

      <label className="mochi-color-field">
        <span className="mochi-color-field-label">
          {localizeUi("ui.ui.colorpicker.lightness")}
          <output>{lightnessPercent}%</output>
        </span>
        <input
          type="range"
          min={4}
          max={96}
          value={lightnessPercent}
          aria-label={localizeUi("ui.ui.colorpicker.lightness")}
          onChange={(event) => emitHsl({ l: Number(event.target.value) / 100 })}
          style={{
            background: `linear-gradient(to right, #000, hsl(${hsl.h} ${saturationPercent}% 50%), #fff)`,
          }}
        />
      </label>

      <div className="mochi-color-preview" role="group" aria-label={localizeUi("ui.chat.mochiosview.colorPreview")}>
        {PREVIEW_TOKENS.map((token) => (
          <i key={token} style={{ background: tokens[token] }} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
