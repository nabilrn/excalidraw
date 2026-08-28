import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getSetting, setSetting } from "./settingsRepository";
import "./settings.css";

const FONT_SCALE_KEY = "utility_font_scale";
const MIN_SCALE = 85;
const MAX_SCALE = 140;
const DEFAULT_SCALE = 100;

const clampScale = (value: number) =>
  Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(value)));

const applyScale = (value: number) => {
  document.documentElement.style.setProperty(
    "--utility-font-scale",
    String(clampScale(value) / 100),
  );
};

const presets = [
  { label: "Compact", value: 90 },
  { label: "Default", value: 100 },
  { label: "Large", value: 115 },
  { label: "XL", value: 130 },
];

export function UtilitySettings() {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [saved, setSaved] = useState(true);
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void getSetting(FONT_SCALE_KEY)
      .then((value) => {
        if (cancelled) {
          return;
        }
        const parsed = value ? Number(value) : DEFAULT_SCALE;
        const next = Number.isFinite(parsed)
          ? clampScale(parsed)
          : DEFAULT_SCALE;
        setScale(next);
        applyScale(next);
      })
      .catch((cause) => {
        console.error(cause);
        applyScale(DEFAULT_SCALE);
      })
      .finally(() => {
        loadedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncTarget = () => {
      const next = document.querySelector(".topbar-actions");
      setPortalTarget((current) => (current === next ? current : next));
      if (!next) {
        setOpen(false);
      }
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    applyScale(scale);

    if (!loadedRef.current) {
      return;
    }

    setSaved(false);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void setSetting(FONT_SCALE_KEY, String(scale))
        .then(() => setSaved(true))
        .catch((cause) => {
          console.error(cause);
          setSaved(false);
        });
    }, 250);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [scale]);

  const setFontScale = (value: number) => setScale(clampScale(value));

  return (
    <>
      {portalTarget &&
        createPortal(
          <button
            className={`utility-settings-launcher ${open ? "is-active" : ""}`}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Open utility settings"
          >
            Settings
          </button>,
          portalTarget,
        )}

      {open && portalTarget && (
        <section className="utility-settings-page" aria-label="Settings">
          <div className="utility-settings-shell">
            <header className="utility-settings-heading">
              <div>
                <p>SETTINGS</p>
                <h1>Workspace utility</h1>
                <span>
                  Controls the FocusCanvas home interface only. Canvas and
                  Excalidraw editor sizing stay unchanged.
                </span>
              </div>
              <button onClick={() => setOpen(false)}>Done</button>
            </header>

            <div className="utility-setting-card">
              <div className="utility-setting-copy">
                <div>
                  <p>INTERFACE</p>
                  <h2>Font size</h2>
                </div>
                <strong>{scale}%</strong>
              </div>

              <input
                className="utility-font-slider"
                type="range"
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={5}
                value={scale}
                onChange={(event) => setFontScale(Number(event.target.value))}
                aria-label="Workspace font size"
              />

              <div className="utility-scale-labels">
                <span>Smaller</span>
                <span>Default</span>
                <span>Larger</span>
              </div>

              <div className="utility-presets">
                {presets.map((preset) => (
                  <button
                    className={scale === preset.value ? "is-active" : ""}
                    key={preset.label}
                    onClick={() => setFontScale(preset.value)}
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.value}%</span>
                  </button>
                ))}
              </div>

              <div className="utility-preview">
                <p>LIVE PREVIEW</p>
                <div className="utility-preview-row">
                  <span className="utility-preview-check" />
                  <strong>Review infrastructure notes</strong>
                  <span>120m</span>
                </div>
                <div className="utility-preview-timer">45:00</div>
              </div>

              <footer className="utility-setting-footer">
                <span>{saved ? "Saved locally" : "Saving…"}</span>
                <button onClick={() => setFontScale(DEFAULT_SCALE)}>
                  Reset to default
                </button>
              </footer>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
