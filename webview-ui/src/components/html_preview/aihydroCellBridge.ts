/**
 * Injected into HTML artifact srcdoc:
 *   - AIHYDRO_PREVIEW_STYLE: AI-Hydro branded design system (one injection per artifact)
 *   - CELL_BRIDGE_SCRIPT:  cell execution bridge + window.aihydro helper API + manifest relay
 *
 * Brand tokens follow branding.md (Section 2 colours, Section 3 typography).
 * Modules using the documented class names get a consistent look without writing any CSS.
 */
export const AIHYDRO_PREVIEW_STYLE = `
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&family=Poppins:wght@400;500;600&family=Nunito:wght@400;700&family=Comfortaa:wght@400;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style id="aihydro-preview-style">
:root {
  --aihydro-blue: #00A3FF;
  --aihydro-cyan: #00DDFF;
  --aihydro-hero-cyan: #00D4FF;
  --aihydro-bright-cyan: #00FFFF;
  --aihydro-bg-deep: #0a0a15;
  --aihydro-bg-navy: #1a1a2e;
  --aihydro-bg-mid: #0f0f1e;
  --aihydro-text: #FFFFFF;
  --aihydro-text-accent: #7dd3fc;
  --aihydro-text-muted: #94a3b8;
  --aihydro-border: rgba(125, 211, 252, 0.18);
  --aihydro-border-strong: rgba(0, 221, 255, 0.45);
  --aihydro-gradient-primary: linear-gradient(135deg, #00A3FF 0%, #00DDFF 100%);
  --aihydro-gradient-hero: linear-gradient(135deg, #00D4FF 0%, #00FFFF 100%);
  --aihydro-font-display: 'Quicksand', system-ui, sans-serif;
  --aihydro-font-heading: 'Poppins', 'Nunito', system-ui, sans-serif;
  --aihydro-font-body: 'Nunito', system-ui, sans-serif;
  --aihydro-font-ui: 'Comfortaa', 'Quicksand', system-ui, sans-serif;
  --aihydro-font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

/* ---- Module shell -------------------------------------------------- */
body.aihydro-module, .aihydro-module {
  background: linear-gradient(180deg, var(--aihydro-bg-deep) 0%, var(--aihydro-bg-navy) 100%);
  color: var(--aihydro-text-accent);
  font-family: var(--aihydro-font-body);
  font-size: 16px;
  line-height: 1.65;
  margin: 0;
  padding: 0;
  min-height: 100vh;
}
.aihydro-module .aihydro-content {
  max-width: 880px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}
.aihydro-module h1, .aihydro-module h2, .aihydro-module h3 {
  font-family: var(--aihydro-font-heading);
  color: var(--aihydro-text);
  letter-spacing: 0.01em;
  line-height: 1.25;
}
.aihydro-module h1 { font-weight: 600; font-size: 32px; margin: 0 0 8px; }
.aihydro-module h2 { font-weight: 600; font-size: 24px; margin: 28px 0 12px; }
.aihydro-module h3 { font-weight: 500; font-size: 19px; margin: 20px 0 8px; }
.aihydro-module p { margin: 0 0 14px; }
.aihydro-module strong { color: var(--aihydro-text); }
.aihydro-module a { color: var(--aihydro-cyan); text-decoration: none; }
.aihydro-module a:hover { text-decoration: underline; }

/* ---- Module header ------------------------------------------------- */
.aihydro-module-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: linear-gradient(135deg, rgba(0,163,255,0.10) 0%, rgba(0,221,255,0.04) 100%);
  border-bottom: 1px solid var(--aihydro-border);
}
.aihydro-module-header .aihydro-brand-mark {
  font-family: var(--aihydro-font-display);
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.04em;
  background: var(--aihydro-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  white-space: nowrap;
}
.aihydro-module-header .aihydro-module-title {
  font-family: var(--aihydro-font-heading);
  font-weight: 600;
  font-size: 18px;
  color: var(--aihydro-text);
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aihydro-module-header .aihydro-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-family: var(--aihydro-font-ui);
  font-size: 11px;
}
.aihydro-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--aihydro-border);
  color: var(--aihydro-text-accent);
  background: rgba(125,211,252,0.06);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.aihydro-pill.is-primary {
  background: var(--aihydro-gradient-primary);
  color: var(--aihydro-bg-deep);
  border: none;
  font-weight: 600;
}

.aihydro-authors {
  font-family: var(--aihydro-font-ui);
  font-size: 12px;
  color: var(--aihydro-text-muted);
  margin: 4px 0 0;
}

/* ---- Steps --------------------------------------------------------- */
.aihydro-step {
  margin: 28px 0;
  padding: 20px 22px;
  background: rgba(15,15,30,0.55);
  border: 1px solid var(--aihydro-border);
  border-radius: 14px;
  position: relative;
}
.aihydro-step[data-aihydro-status="done"]   { border-color: var(--aihydro-border-strong); }
.aihydro-step[data-aihydro-status="active"] { box-shadow: 0 0 0 1px var(--aihydro-cyan), 0 10px 30px rgba(0,221,255,0.10); }
.aihydro-step > .aihydro-step-index {
  position: absolute; top: -14px; left: 18px;
  background: var(--aihydro-gradient-primary);
  color: var(--aihydro-bg-deep);
  font-family: var(--aihydro-font-ui); font-weight: 600;
  padding: 4px 12px; border-radius: 999px; font-size: 12px;
  letter-spacing: 0.04em;
}

/* ---- Callouts ------------------------------------------------------ */
.aihydro-callout {
  border-left: 3px solid var(--aihydro-cyan);
  background: rgba(0,221,255,0.06);
  padding: 12px 14px;
  border-radius: 0 10px 10px 0;
  margin: 16px 0;
  font-size: 15px;
}
.aihydro-callout .aihydro-callout-title {
  font-family: var(--aihydro-font-heading);
  font-weight: 600;
  color: var(--aihydro-text);
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.aihydro-callout.is-note    { border-color: var(--aihydro-cyan); }
.aihydro-callout.is-warning { border-color: #facc15; background: rgba(250,204,21,0.07); }
.aihydro-callout.is-tip     { border-color: #34d399; background: rgba(52,211,153,0.07); }
.aihydro-callout.is-agent   {
  border-color: var(--aihydro-blue);
  background: linear-gradient(135deg, rgba(0,163,255,0.10), rgba(0,221,255,0.04));
}
.aihydro-callout.is-warning .aihydro-callout-title { color: #facc15; }
.aihydro-callout.is-tip .aihydro-callout-title     { color: #34d399; }

/* ---- Figures ------------------------------------------------------- */
.aihydro-figure {
  margin: 18px 0;
  padding: 12px;
  background: var(--aihydro-bg-deep);
  border: 1px solid var(--aihydro-border);
  border-radius: 10px;
}
.aihydro-figure img, .aihydro-figure svg, .aihydro-figure canvas {
  display: block; max-width: 100%; height: auto;
  margin: 0 auto; border-radius: 6px;
}
.aihydro-figure-caption {
  font-family: var(--aihydro-font-ui);
  font-size: 12px;
  color: var(--aihydro-text-muted);
  text-align: center;
  margin-top: 8px;
}

/* ---- Parameter panel ---------------------------------------------- */
.aihydro-params {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin: 16px 0;
  padding: 14px 16px;
  background: rgba(0,163,255,0.05);
  border: 1px dashed var(--aihydro-border-strong);
  border-radius: 10px;
}
.aihydro-param-row {
  display: flex; flex-direction: column; gap: 6px;
}
.aihydro-param-row label,
.aihydro-params label {
  font-family: var(--aihydro-font-ui);
  font-size: 12px;
  color: var(--aihydro-text-accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.aihydro-params input[type="number"],
.aihydro-params input[type="text"],
.aihydro-params select {
  background: var(--aihydro-bg-deep);
  border: 1px solid var(--aihydro-border);
  color: var(--aihydro-text);
  font-family: var(--aihydro-font-mono);
  padding: 6px 10px; border-radius: 6px; font-size: 14px;
}
.aihydro-params input[type="range"] {
  accent-color: var(--aihydro-cyan);
  width: 100%;
}
.aihydro-param-value {
  font-family: var(--aihydro-font-mono);
  color: var(--aihydro-cyan);
  font-size: 13px;
}

/* ---- Buttons ------------------------------------------------------- */
.aihydro-button,
.aihydro-run {
  font-family: var(--aihydro-font-ui);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.04em;
  padding: 7px 16px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: var(--aihydro-gradient-primary);
  color: var(--aihydro-bg-deep);
  transition: transform 0.1s ease, box-shadow 0.2s ease;
}
.aihydro-button:hover,
.aihydro-run:hover { box-shadow: 0 6px 18px rgba(0,221,255,0.30); transform: translateY(-1px); }
.aihydro-button:disabled,
.aihydro-run:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }
.aihydro-button.is-ghost {
  background: transparent; color: var(--aihydro-cyan);
  border: 1px solid var(--aihydro-border-strong);
}

/* ---- Cells (executable code) -------------------------------------- */
.aihydro-cell {
  border: 1px solid var(--aihydro-border);
  border-radius: 10px;
  margin: 14px 0;
  padding: 12px 14px;
  background: var(--aihydro-bg-deep);
  color: var(--aihydro-text-accent);
  position: relative;
}
.aihydro-cell[data-aihydro-focused="1"] {
  outline: 1px solid var(--aihydro-cyan);
}
.aihydro-cell .aihydro-cell-header {
  display: flex; align-items: center; gap: 10px;
  font-family: var(--aihydro-font-ui);
  font-size: 11px;
  color: var(--aihydro-text-muted);
  margin-bottom: 8px;
}
.aihydro-cell .aihydro-cell-header .aihydro-cell-lang {
  background: rgba(0,221,255,0.10);
  color: var(--aihydro-cyan);
  padding: 2px 8px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: 0.08em;
}
.aihydro-source {
  font-family: var(--aihydro-font-mono);
  font-size: 13px;
  white-space: pre-wrap;
  margin: 0 0 10px;
  padding: 10px;
  background: var(--aihydro-bg-mid);
  border-radius: 6px;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 280px;
  resize: vertical;
  color: var(--aihydro-text);
  transition: max-height 0.2s ease, opacity 0.15s ease;
  scrollbar-width: thin;
  scrollbar-color: rgba(125,211,252,0.25) transparent;
}
.aihydro-source::-webkit-scrollbar { width: 6px; height: 6px; }
.aihydro-source::-webkit-scrollbar-track { background: transparent; }
.aihydro-source::-webkit-scrollbar-thumb { background: rgba(125,211,252,0.25); border-radius: 3px; }
.aihydro-source.is-collapsed {
  max-height: 3.2em;
  overflow: hidden;
  cursor: pointer;
  opacity: 0.65;
  -webkit-mask-image: linear-gradient(to bottom, black 20%, transparent 100%);
  mask-image: linear-gradient(to bottom, black 20%, transparent 100%);
  margin-bottom: 4px;
  user-select: none;
}
.aihydro-toggle-source {
  font-family: var(--aihydro-font-ui);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--aihydro-border);
  background: transparent;
  color: var(--aihydro-text-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.aihydro-toggle-source:hover {
  color: var(--aihydro-cyan);
  border-color: var(--aihydro-border-strong);
  background: rgba(0,221,255,0.06);
}
.aihydro-copy {
  font-family: var(--aihydro-font-ui);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--aihydro-border);
  cursor: pointer;
  background: transparent;
  color: var(--aihydro-text-muted);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  margin-left: auto;
}
.aihydro-copy:hover { color: var(--aihydro-cyan); border-color: var(--aihydro-border-strong); background: rgba(0,221,255,0.06); }
.aihydro-copy.copied { color: #34d399; border-color: #34d399; }
.aihydro-output-wrap {
  position: relative;
}
.aihydro-copy-output {
  position: absolute;
  top: 6px; right: 8px;
  font-family: var(--aihydro-font-ui);
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--aihydro-border);
  background: rgba(10,10,21,0.75);
  color: var(--aihydro-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  z-index: 2;
  white-space: nowrap;
}
.aihydro-output-wrap:hover .aihydro-copy-output { opacity: 1; }
.aihydro-copy-output:hover { color: var(--aihydro-cyan); border-color: var(--aihydro-border-strong); }
.aihydro-copy-output.copied { color: #34d399; border-color: #34d399; }
.aihydro-output {
  font-family: var(--aihydro-font-mono);
  font-size: 13px;
  white-space: pre-wrap;
  min-height: 1.2em;
  margin: 0;
  padding: 10px;
  background: rgba(0,0,0,0.30);
  border-radius: 6px;
  max-height: 320px;
  overflow: auto;
  color: var(--aihydro-text-accent);
  scrollbar-width: thin;
  scrollbar-color: rgba(125,211,252,0.20) transparent;
}
.aihydro-output::-webkit-scrollbar { width: 6px; height: 6px; }
.aihydro-output::-webkit-scrollbar-track { background: transparent; }
.aihydro-output::-webkit-scrollbar-thumb { background: rgba(125,211,252,0.20); border-radius: 3px; }
.aihydro-output:empty::before {
  content: "(no output yet)";
  color: var(--aihydro-text-muted); font-style: italic;
}
.aihydro-stderr { color: #f48771; }
.aihydro-stdout { color: var(--aihydro-text-accent); }
.aihydro-error  { color: #f87171; }
.aihydro-output-images { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.aihydro-output-images img { max-width: 100%; height: auto; border-radius: 4px; }
.aihydro-truncated { font-size: 11px; opacity: 0.75; margin-top: 6px; }

/* ---- Standalone-mode pill (replaces run buttons outside the preview) */
.aihydro-standalone-pill {
  font-family: var(--aihydro-font-ui);
  font-size: 12px;
  color: var(--aihydro-text-muted);
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px dashed var(--aihydro-border);
  background: rgba(125,211,252,0.05);
  cursor: not-allowed;
  display: inline-flex; align-items: center; gap: 6px;
}
.aihydro-standalone-pill::before {
  content: "↗"; color: var(--aihydro-cyan); font-weight: 700;
}

/* ---- Quiz / question --------------------------------------------- */
.aihydro-question {
  margin: 16px 0;
  padding: 16px 18px;
  background: rgba(0,163,255,0.06);
  border: 1px solid var(--aihydro-border);
  border-radius: 10px;
}
.aihydro-question .aihydro-question-prompt {
  font-family: var(--aihydro-font-heading);
  font-weight: 500;
  color: var(--aihydro-text);
  margin-bottom: 10px;
}
.aihydro-question .aihydro-choices {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.aihydro-choice {
  font-family: var(--aihydro-font-ui);
  font-size: 13px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--aihydro-border);
  background: var(--aihydro-bg-deep);
  color: var(--aihydro-text-accent);
  cursor: pointer;
  text-align: left;
}
.aihydro-choice:hover { border-color: var(--aihydro-cyan); color: var(--aihydro-cyan); }
.aihydro-choice[data-aihydro-state="correct"]   { background: rgba(52,211,153,0.18); border-color: #34d399; color: #d1fae5; }
.aihydro-choice[data-aihydro-state="incorrect"] { background: rgba(248,113,113,0.15); border-color: #f87171; color: #fee2e2; }
.aihydro-feedback {
  margin-top: 10px;
  font-size: 14px;
  font-family: var(--aihydro-font-body);
  color: var(--aihydro-text-accent);
  min-height: 1.2em;
}

/* ---- Reveal ------------------------------------------------------- */
.aihydro-reveal {
  border: 1px solid var(--aihydro-border);
  border-radius: 8px;
  margin: 12px 0;
  background: var(--aihydro-bg-mid);
}
.aihydro-reveal > summary {
  cursor: pointer;
  padding: 10px 14px;
  font-family: var(--aihydro-font-ui);
  font-weight: 600;
  color: var(--aihydro-cyan);
  list-style: none;
}
.aihydro-reveal > summary::-webkit-details-marker { display: none; }
.aihydro-reveal > summary::before {
  content: "▸"; display: inline-block; margin-right: 8px;
  transition: transform 0.15s ease;
}
.aihydro-reveal[open] > summary::before { transform: rotate(90deg); }
.aihydro-reveal-body { padding: 0 14px 12px; }

/* ---- Provenance footer ------------------------------------------- */
.aihydro-provenance {
  margin: 32px 0 0;
  padding: 18px 20px;
  border-top: 1px solid var(--aihydro-border);
  background: rgba(15,15,30,0.50);
  font-family: var(--aihydro-font-ui);
  font-size: 12px;
  color: var(--aihydro-text-muted);
  border-radius: 0 0 12px 12px;
}
.aihydro-provenance dt {
  color: var(--aihydro-text-accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 11px;
  margin-top: 8px;
}
.aihydro-provenance dd { margin: 2px 0 0; color: var(--aihydro-text-muted); }
.aihydro-provenance .aihydro-cite {
  display: block; margin-top: 10px; font-style: italic;
  color: var(--aihydro-text-accent);
}

/* ---- Radio-input quiz (SKILL.md standard format) ------------------- */
.aihydro-quiz { margin: 18px 0; }
.aihydro-quiz-question {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--aihydro-border);
  border-radius: 8px;
  background: rgba(0,163,255,0.04);
  transition: border-color 0.2s, background 0.2s;
}
.aihydro-quiz-question.aq-correct {
  border-color: rgba(52,211,153,0.40);
  background: rgba(52,211,153,0.06);
}
.aihydro-quiz-question.aq-incorrect {
  border-color: rgba(248,113,113,0.35);
  background: rgba(248,113,113,0.05);
}
.aihydro-quiz-question .q-text {
  font-family: var(--aihydro-font-heading);
  font-weight: 500;
  color: var(--aihydro-text);
  margin: 0 0 10px;
}
.aihydro-quiz-option {
  display: flex; align-items: baseline; gap: 8px;
  margin: 6px 0;
  cursor: pointer;
  font-size: 14px;
  color: var(--aihydro-text-accent);
}
.aihydro-quiz-option input[type="radio"] { cursor: pointer; accent-color: var(--aihydro-cyan); }
.aihydro-quiz-feedback {
  margin-top: 10px; padding: 8px 12px;
  border-left: 2px solid var(--aihydro-border);
  background: rgba(148,163,184,0.07);
  font-size: 13px; color: var(--aihydro-text-accent);
  border-radius: 0 4px 4px 0;
  display: none;
}
.aihydro-quiz-question.aq-incorrect .aihydro-quiz-feedback[data-show="true"] { display: block; }
.aihydro-quiz-submit {
  padding: 7px 18px;
  border: 1px solid var(--aihydro-cyan);
  border-radius: 999px;
  background: transparent;
  color: var(--aihydro-cyan);
  font-family: var(--aihydro-font-ui);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.aihydro-quiz-submit:hover { background: rgba(0,221,255,0.10); }
#quizScore { font-size: 14px; color: var(--aihydro-text-accent); margin-left: 14px; }
</style>`

export const CELL_BRIDGE_SCRIPT = `<script>(function(){
  var registry = { cellIds: [], pythonCount: 0 };
  var focusedCellId = "";
  var runAllQueue = null;
  // Standalone = artifact opened directly in a browser, not inside the AI-Hydro webview.
  var isStandalone = (function(){
    try { return window.parent === window; } catch(_) { return true; }
  })();

  function postToParent(payload) {
    if (isStandalone) return;
    try { window.parent.postMessage(payload, "*"); } catch(_) {}
  }

  function cellId(el) {
    return el.getAttribute("data-aihydro-cell-id") || el.id || "";
  }

  function scanCells() {
    var cells = document.querySelectorAll(".aihydro-cell");
    registry.cellIds = [];
    registry.pythonCount = 0;
    cells.forEach(function(c) {
      var id = cellId(c);
      if (id) registry.cellIds.push(id);
      var lang = (c.getAttribute("data-language") || "python").toLowerCase();
      if (lang === "python" || lang === "py") registry.pythonCount++;
    });
    mergeJsonMetadata();
    postToParent(artifactPayload({
      type: "artifact/cellRegistry",
      cellIds: registry.cellIds.slice(),
      pythonCount: registry.pythonCount
    }));
  }

  function mergeJsonMetadata() {
    document.querySelectorAll('script[type="application/vnd.aihydro.cell+json"]').forEach(function(script) {
      try {
        var meta = JSON.parse(script.textContent || "{}");
        if (!meta.id) return;
        var el = document.querySelector('[data-aihydro-cell-id="' + meta.id + '"]');
        if (!el) return;
        if (meta.language) el.setAttribute("data-language", meta.language);
        if (meta.execution) el.setAttribute("data-execution", meta.execution);
        if (meta.timeoutSeconds) el.setAttribute("data-timeout-seconds", String(meta.timeoutSeconds));
      } catch (_) {}
    });
  }

  function broadcastManifest() {
    var script = document.querySelector('script[type="application/vnd.aihydro.module+json"]');
    if (!script) return null;
    try {
      var manifest = JSON.parse(script.textContent || "{}");
      postToParent({
        source: "aihydro-artifact",
        type: "artifact/manifest",
        manifest: manifest
      });
      return manifest;
    } catch (_) { return null; }
  }

  function artifactPayload(extra) {
    var base = window.__aihydroArtifact || {};
    return Object.assign({ source: "aihydro-artifact" }, base, extra || {});
  }

  function formatLegacy(msg) {
    var lines = [];
    if (msg.status === "denied") {
      lines.push("Python execution was denied.");
      lines.push("Trust the workspace or set aihydro.htmlPreview.pythonExecution to always.");
    }
    if (msg.stdout) lines.push("STDOUT:\\n" + msg.stdout);
    if (msg.stderr) lines.push("STDERR:\\n" + msg.stderr);
    if (msg.error) lines.push("ERROR:\\n" + msg.error);
    if (msg.result_repr) lines.push("RESULT:\\n" + msg.result_repr);
    if (lines.length === 0) lines.push("STATUS: " + (msg.status || "unknown"));
    return lines.join("\\n\\n");
  }

  function renderOutputs(container, msg) {
    if (!container) return;
    var wrap = container.parentElement && container.parentElement.querySelector(".aihydro-output-images");
    if (wrap) wrap.remove();
    container.innerHTML = "";
    var outputs = msg.outputs || [];
    if (outputs.length === 0) {
      container.textContent = formatLegacy(msg);
      if (msg.images && msg.images.length) renderImages(container, msg.images);
      return;
    }
    outputs.forEach(function(o) {
      if (o.type === "stdout" && o.text) {
        var pre = document.createElement("pre");
        pre.className = "aihydro-stdout";
        pre.textContent = o.text;
        container.appendChild(pre);
      } else if (o.type === "stderr" && o.text) {
        var err = document.createElement("pre");
        err.className = "aihydro-stderr";
        err.textContent = o.text;
        container.appendChild(err);
      } else if (o.type === "error" && o.text) {
        var er = document.createElement("pre");
        er.className = "aihydro-error";
        er.textContent = o.text;
        container.appendChild(er);
      } else if (o.type === "image/png" && o.data) {
        renderImages(container, [o.data]);
      }
    });
    if (msg.truncated) {
      var t = document.createElement("div");
      t.className = "aihydro-truncated";
      t.textContent = "Output truncated.";
      container.appendChild(t);
    }
  }

  function renderImages(container, images) {
    var wrap = document.createElement("div");
    wrap.className = "aihydro-output-images";
    images.forEach(function(b64) {
      var img = document.createElement("img");
      img.src = "data:image/png;base64," + b64;
      img.alt = "figure";
      wrap.appendChild(img);
    });
    if (container.parentElement) container.parentElement.appendChild(wrap);
  }

  function findCell(id) {
    if (id) return document.querySelector('[data-aihydro-cell-id="' + id + '"]');
    if (focusedCellId) return document.querySelector('[data-aihydro-cell-id="' + focusedCellId + '"]');
    return document.querySelector('.aihydro-cell[data-language="python"], .aihydro-cell');
  }

  function pythonCells() {
    return Array.from(document.querySelectorAll(".aihydro-cell")).filter(function(c) {
      var lang = (c.getAttribute("data-language") || "python").toLowerCase();
      return lang === "python" || lang === "py";
    });
  }

  /**
   * Cell source can be a *template* containing {{paramName}} placeholders.
   * When a bound input changes, we re-substitute the template and rewrite the
   * visible <pre class="aihydro-source"> body so users see exactly what runs.
   */
  function applyParamsToCell(cell) {
    var template = cell.getAttribute("data-source-template");
    if (!template) {
      var sourceEl = cell.querySelector(".aihydro-source");
      if (!sourceEl) return;
      template = sourceEl.textContent || "";
      cell.setAttribute("data-source-template", template);
    }
    var params = cell.__aihydroParams || {};
    var rendered = template.replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, function(_, key) {
      return params[key] != null ? String(params[key]) : ("{{" + key + "}}");
    });
    var sourceEl2 = cell.querySelector(".aihydro-source");
    if (sourceEl2) sourceEl2.textContent = rendered;
  }

  function runJavaScriptInCell(cell, code) {
    var output = cell.querySelector(".aihydro-output");
    try {
      var fn = new Function(code);
      var result = fn();
      var text = result === undefined ? "(no return value)" : JSON.stringify(result, null, 2);
      if (output) output.textContent = text;
    } catch (err) {
      if (output) output.textContent = "Error:\\n" + (err && err.message || err);
    }
  }

  function requestPythonRun(cell) {
    applyParamsToCell(cell);
    var output = cell.querySelector(".aihydro-output");
    var sourceEl = cell.querySelector(".aihydro-source");
    var code = sourceEl ? (sourceEl.textContent || "") : "";
    var cid = cellId(cell);
    if (isStandalone) {
      if (output) output.textContent = "↗ Open this module inside AI-Hydro to run Python cells.";
      return cid;
    }
    if (output) {
      output.textContent = "Running Python…";
      output.dataset.aihydroAwaiting = "1";
    }
    postToParent(artifactPayload({
      type: "artifact/runCode",
      language: "python",
      code: code,
      cellId: cid
    }));
    return cid;
  }

  function runCellById(id) {
    var cell = findCell(id);
    if (!cell) return;
    var lang = (cell.getAttribute("data-language") || "python").toLowerCase();
    var sourceEl = cell.querySelector(".aihydro-source");
    var code = sourceEl ? (sourceEl.textContent || "") : "";
    if (lang === "javascript" || lang === "js") {
      runJavaScriptInCell(cell, code);
    } else {
      requestPythonRun(cell);
    }
  }

  function clearAllOutputs() {
    document.querySelectorAll(".aihydro-output").forEach(function(o) {
      o.textContent = "";
      o.dataset.aihydroAwaiting = "";
    });
    document.querySelectorAll(".aihydro-output-images").forEach(function(w) { w.remove(); });
    var legacy = document.getElementById("pythonOutput");
    if (legacy) legacy.textContent = "";
  }

  function wireCells() {
    document.querySelectorAll(".aihydro-cell").forEach(function(cell) {
      cell.addEventListener("click", function() {
        focusedCellId = cellId(cell);
        document.querySelectorAll(".aihydro-cell").forEach(function(c) {
          c.setAttribute("data-aihydro-focused", c === cell ? "1" : "0");
        });
      });
      var runBtn = cell.querySelector(".aihydro-run");
      if (runBtn && runBtn.dataset.aihydroWired !== "1") {
        runBtn.dataset.aihydroWired = "1";
        if (isStandalone && (cell.getAttribute("data-language") || "python").toLowerCase() !== "javascript") {
          var pill = document.createElement("span");
          pill.className = "aihydro-standalone-pill";
          pill.textContent = "Open in AI-Hydro to run";
          runBtn.parentNode.replaceChild(pill, runBtn);
        } else {
          runBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            focusedCellId = cellId(cell);
            runCellById(focusedCellId);
          });
        }
      }
      // ── Toggle source (auto-collapse if > 20 lines) ─────────────────
      if (!cell.querySelector(".aihydro-toggle-source")) {
        var srcPreEl = cell.querySelector(".aihydro-source");
        if (srcPreEl) {
          var lineCount = (srcPreEl.textContent || "").split("\\n").length;
          var startCollapsed = lineCount > 20;
          if (startCollapsed) srcPreEl.classList.add("is-collapsed");
          var toggleBtn = document.createElement("button");
          toggleBtn.type = "button";
          toggleBtn.className = "aihydro-toggle-source";
          toggleBtn.textContent = startCollapsed ? "Show code \\u25be" : "Hide code \\u25b4";
          toggleBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            var collapsed = srcPreEl.classList.toggle("is-collapsed");
            toggleBtn.textContent = collapsed ? "Show code \\u25be" : "Hide code \\u25b4";
          });
          // Clicking the collapsed pre also expands it
          srcPreEl.addEventListener("click", function() {
            if (srcPreEl.classList.contains("is-collapsed")) {
              srcPreEl.classList.remove("is-collapsed");
              toggleBtn.textContent = "Hide code \\u25b4";
            }
          });
          var hdr2 = cell.querySelector(".aihydro-cell-header, .cell-header");
          var rnEl = cell.querySelector(".aihydro-run, .aihydro-standalone-pill");
          if (hdr2 && rnEl) {
            hdr2.insertBefore(toggleBtn, rnEl);
          } else if (hdr2) {
            hdr2.appendChild(toggleBtn);
          }
        }
      }

      if (!cell.querySelector(".aihydro-copy")) {
        var copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "aihydro-copy";
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          var src = cell.querySelector(".aihydro-source");
          var text = src ? (src.textContent || "") : "";
          navigator.clipboard.writeText(text).then(function() {
            copyBtn.textContent = "Copied!";
            copyBtn.classList.add("copied");
            setTimeout(function() {
              copyBtn.textContent = "Copy";
              copyBtn.classList.remove("copied");
            }, 1500);
          });
        });
        var header = cell.querySelector(".aihydro-cell-header, .cell-header");
        var runEl = cell.querySelector(".aihydro-run, .aihydro-standalone-pill");
        if (header && runEl) {
          header.insertBefore(copyBtn, runEl);
        } else if (header) {
          header.appendChild(copyBtn);
        } else {
          var src = cell.querySelector(".aihydro-source");
          if (src) src.parentNode.insertBefore(copyBtn, src);
        }
      }

      // ── Output copy button ──────────────────────────────────────────
      var outputEl = cell.querySelector(".aihydro-output");
      if (outputEl && !outputEl.parentElement.classList.contains("aihydro-output-wrap")) {
        var wrap = document.createElement("div");
        wrap.className = "aihydro-output-wrap";
        outputEl.parentNode.insertBefore(wrap, outputEl);
        wrap.appendChild(outputEl);
        var copyOutBtn = document.createElement("button");
        copyOutBtn.type = "button";
        copyOutBtn.className = "aihydro-copy-output";
        copyOutBtn.textContent = "Copy output";
        copyOutBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          var text = (outputEl.textContent || "").trim();
          if (!text || text === "(no output yet)") return;
          navigator.clipboard.writeText(text).then(function() {
            copyOutBtn.textContent = "Copied!";
            copyOutBtn.classList.add("copied");
            setTimeout(function() {
              copyOutBtn.textContent = "Copy output";
              copyOutBtn.classList.remove("copied");
            }, 1500);
          });
        });
        wrap.appendChild(copyOutBtn);
      }
    });
    scanCells();
  }

  window.addEventListener("message", function(event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.type === "artifact/runCodeResult") {
      var targetId = msg.cellId || "";
      document.querySelectorAll(".aihydro-cell").forEach(function(cell) {
        var cid = cellId(cell);
        if (targetId && cid !== targetId) return;
        var output = cell.querySelector(".aihydro-output");
        if (!output || output.dataset.aihydroAwaiting !== "1") {
          if (!targetId) return;
        }
        output.dataset.aihydroAwaiting = "";
        renderOutputs(output, msg);
      });
      var legacyOut = document.getElementById("pythonOutput");
      if (legacyOut && (!targetId || !document.querySelector('[data-aihydro-cell-id="' + targetId + '"]'))) {
        legacyOut.textContent = "AI-Hydro Python Result:\\n\\n" + formatLegacy(msg);
        if (msg.images && msg.images.length) renderImages(legacyOut, msg.images);
      }
      if (runAllQueue) runAllQueue.onResult(msg);
      return;
    }
    if (msg.type !== "artifact/command") return;
    if (msg.command === "runCell") runCellById(msg.cellId || focusedCellId);
    if (msg.command === "runAll") startRunAll();
    if (msg.command === "clearOutputs") clearAllOutputs();
    if (msg.command === "rescan") scanCells();
  });

  function startRunAll() {
    var cells = pythonCells();
    var idx = 0;
    runAllQueue = {
      onResult: function() {
        idx++;
        if (idx >= cells.length) {
          runAllQueue = null;
          postToParent(artifactPayload({ type: "artifact/runAllComplete" }));
          return;
        }
        postToParent(artifactPayload({
          type: "artifact/runAllProgress",
          current: idx + 1, total: cells.length
        }));
        requestPythonRun(cells[idx]);
      }
    };
    if (cells.length === 0) { runAllQueue = null; return; }
    postToParent(artifactPayload({
      type: "artifact/runAllProgress",
      current: 1, total: cells.length
    }));
    requestPythonRun(cells[0]);
  }

  // -------------------------------------------------------------------
  //  window.aihydro — opt-in helper API for module authors.
  //  All helpers are pure DOM; no kernel dependency.
  // -------------------------------------------------------------------
  var api = {
    isStandalone: isStandalone,

    /**
     * Bind an input element to a cell's parameter slot.
     *   aihydro.bindParam({ from: '#slope', cellId: 'twi-cell', name: 'slope', autorun: true })
     * The cell's <pre class="aihydro-source"> is treated as a template with
     * {{name}} placeholders that get re-substituted on every input change.
     */
    bindParam: function(opts) {
      if (!opts || !opts.cellId || !opts.name) return;
      var input = typeof opts.from === "string" ? document.querySelector(opts.from) : opts.from;
      var cell = document.querySelector('[data-aihydro-cell-id="' + opts.cellId + '"]');
      if (!input || !cell) return;
      cell.__aihydroParams = cell.__aihydroParams || {};
      var sync = function() {
        cell.__aihydroParams[opts.name] = input.value;
        applyParamsToCell(cell);
        // live-update any <span data-aihydro-mirror="name"> labels
        document.querySelectorAll('[data-aihydro-mirror="' + opts.name + '"]').forEach(function(el){
          el.textContent = input.value;
        });
        if (opts.onChange) try { opts.onChange(input.value); } catch(_){}
        if (opts.autorun) {
          clearTimeout(cell.__aihydroAutorun);
          cell.__aihydroAutorun = setTimeout(function() { runCellById(opts.cellId); }, 250);
        }
      };
      input.addEventListener("input", sync);
      input.addEventListener("change", sync);
      sync();
    },

    /** Wire a multiple-choice quiz block.
     *   <div class="aihydro-question" data-aihydro-answer="b"> ... </div>
     *   aihydro.quiz(); // auto-wires all such blocks
     */
    quiz: function(rootSelector) {
      var roots = rootSelector
        ? document.querySelectorAll(rootSelector)
        : document.querySelectorAll(".aihydro-question[data-aihydro-answer]");
      roots.forEach(function(root) {
        if (root.dataset.aihydroWired === "1") return;
        root.dataset.aihydroWired = "1";
        var answer = root.getAttribute("data-aihydro-answer");
        var feedback = root.querySelector(".aihydro-feedback");
        root.querySelectorAll(".aihydro-choice").forEach(function(btn) {
          btn.addEventListener("click", function() {
            var choice = btn.getAttribute("data-aihydro-choice");
            var correct = choice === answer;
            root.querySelectorAll(".aihydro-choice").forEach(function(b){ b.removeAttribute("data-aihydro-state"); });
            btn.setAttribute("data-aihydro-state", correct ? "correct" : "incorrect");
            if (feedback) {
              feedback.textContent = correct
                ? (btn.getAttribute("data-aihydro-success") || "Correct.")
                : (btn.getAttribute("data-aihydro-explain") || "Not quite — try again.");
            }
          });
        });
      });
    },

    /** Wire reveal/details blocks (no-op for native <details>, but normalises class). */
    reveal: function(rootSelector) {
      var roots = rootSelector
        ? document.querySelectorAll(rootSelector)
        : document.querySelectorAll(".aihydro-reveal");
      roots.forEach(function(d) {
        if (d.tagName !== "DETAILS") {
          // promote a div into details-like structure
          d.setAttribute("tabindex", "0");
          var summary = d.querySelector(".aihydro-reveal-summary");
          var body = d.querySelector(".aihydro-reveal-body");
          if (summary && body) {
            body.hidden = !d.hasAttribute("data-aihydro-open");
            summary.addEventListener("click", function() { body.hidden = !body.hidden; });
          }
        }
      });
    },

    /** Scroll-driven step progression. Calls onStep(stepEl, index) as each enters the viewport. */
    scrolly: function(stepSelector, onStep) {
      var steps = Array.prototype.slice.call(document.querySelectorAll(stepSelector));
      if (!steps.length || typeof IntersectionObserver === "undefined") return;
      var obs = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            var i = steps.indexOf(entry.target);
            steps.forEach(function(s, j) {
              s.setAttribute("data-aihydro-status", j < i ? "done" : j === i ? "active" : "");
            });
            if (onStep) try { onStep(entry.target, i); } catch(_) {}
          }
        });
      }, { threshold: 0.55 });
      steps.forEach(function(s) { obs.observe(s); });
    },

    /**
     * Rewrite a cell's source code programmatically and optionally run it.
     * Use this instead of {{}} template tokens — it works with all installed versions.
     *
     *   aihydro.rewriteCell('twi-point', function() {
     *     return 'import math\nx = ' + slider.value + '\nprint(x)';
     *   });
     *   aihydro.rewriteCell('twi-point', function(prev) { return prev + '\nprint("done")'; }, true);
     */
    rewriteCell: function(cellId, codeFn, autorun) {
      var cell = document.querySelector('[data-aihydro-cell-id="' + cellId + '"]');
      if (!cell) return;
      var src = cell.querySelector(".aihydro-source");
      if (!src) return;
      var newCode = codeFn(src.textContent || "");
      src.textContent = newCode;
      if (autorun) {
        clearTimeout(cell.__aihydroAutorun);
        cell.__aihydroAutorun = setTimeout(function() { runCellById(cellId); }, 250);
      }
    },

    /** Programmatic cell control for advanced authors. */
    runCell: function(id) { runCellById(id); },
    rescan: function() { scanCells(); }
  };
  window.aihydro = api;

  function wireRadioQuiz() {
    document.querySelectorAll('[id$="SubmitBtn"], .aihydro-quiz-submit').forEach(function(btn) {
      if (btn.dataset.aqWired === "1") return;
      btn.dataset.aqWired = "1";
      btn.addEventListener("click", function() {
        var quizRoot = btn.closest(".aihydro-quiz") || btn.parentElement;
        if (!quizRoot) return;
        var questions = quizRoot.querySelectorAll(".aihydro-quiz-question[data-answer]");
        var correct = 0;
        questions.forEach(function(q) {
          q.classList.remove("aq-correct", "aq-incorrect");
          q.querySelectorAll(".aihydro-quiz-feedback").forEach(function(f) { f.setAttribute("data-show", "false"); });
          var correctIdx = parseInt(q.getAttribute("data-answer") || "-1", 10);
          var checked = q.querySelector("input[type='radio']:checked");
          if (!checked) return;
          var selectedIdx = parseInt(checked.value, 10);
          if (selectedIdx === correctIdx) {
            q.classList.add("aq-correct"); correct++;
          } else {
            q.classList.add("aq-incorrect");
            var fb = q.querySelector(".aihydro-quiz-feedback[data-fb='" + selectedIdx + "']");
            if (fb) fb.setAttribute("data-show", "true");
          }
        });
        var scoreEl = btn.parentElement && btn.parentElement.querySelector("#quizScore, [id$='Score']");
        if (!scoreEl) scoreEl = document.getElementById("quizScore");
        if (scoreEl) scoreEl.textContent = correct + " / " + questions.length + " correct";
      });
    });
  }

  function init() {
    if (isStandalone) document.documentElement.setAttribute("data-aihydro-standalone", "1");
    broadcastManifest();
    wireCells();
    api.quiz();
    api.reveal();
    wireRadioQuiz();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  try {
    var obs = new MutationObserver(function() { scanCells(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
})();</script>`
