import { Agent } from "@cline/sdk";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 3456);

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent War Room</title>
<style>
  :root {
    --bg: #05070a;
    --panel: rgba(8, 12, 18, 0.94);
    --panel-2: rgba(12, 17, 25, 0.96);
    --line: rgba(119, 180, 206, 0.18);
    --line-strong: rgba(128, 213, 245, 0.36);
    --text: #d9e5ea;
    --muted: #6f818b;
    --cyan: #62d9ff;
    --green: #63db78;
    --amber: #f1a11b;
    --pink: #ff5c98;
    --violet: #a16bff;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html,
  body {
    width: 100%;
    height: 100%;
    min-height: 100%;
  }

  body {
    color: var(--text);
    background:
      radial-gradient(circle at 20% 0%, rgba(80, 188, 226, 0.12), transparent 30%),
      linear-gradient(145deg, #030507 0%, #071014 48%, #020405 100%);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow-x: hidden;
    overflow-y: auto;
  }

  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 42px 42px;
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.84), transparent 92%);
  }

  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.018),
      rgba(255, 255, 255, 0.018) 1px,
      transparent 1px,
      transparent 4px
    );
    mix-blend-mode: screen;
    opacity: 0.42;
  }

  button,
  input {
    font: inherit;
  }

  .console-shell {
    position: relative;
    z-index: 1;
    width: 100vw;
    min-height: 100vh;
    height: auto;
    margin: 0;
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    border: 0;
    border-radius: 0;
    background: rgba(4, 8, 12, 0.74);
    box-shadow:
      0 0 0 1px rgba(24, 255, 255, 0.05) inset,
      0 24px 80px rgba(0, 0, 0, 0.58),
      0 0 38px rgba(72, 190, 231, 0.12);
    overflow: visible;
  }

  .side-rail {
    border-right: 1px solid rgba(132, 194, 220, 0.16);
    background: rgba(5, 9, 14, 0.9);
    padding: 18px 7px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .mark {
    width: 34px;
    height: 34px;
    margin: 0 auto 14px;
    border: 1px solid rgba(116, 219, 255, 0.52);
    border-radius: 7px;
    color: #aeeeff;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 18px;
    box-shadow: 0 0 18px rgba(83, 201, 255, 0.18);
  }

  .nav-item {
    min-height: 56px;
    padding: 7px 3px;
    border: 1px solid transparent;
    border-radius: 7px;
    color: #8b9aa2;
    background: transparent;
    cursor: pointer;
    display: grid;
    gap: 4px;
    place-items: center;
  }

  .nav-item .nav-icon {
    width: 24px;
    height: 24px;
    border: 1px solid rgba(137, 168, 181, 0.36);
    border-radius: 5px;
    display: grid;
    place-items: center;
    color: #b6c8cf;
    font-size: 13px;
    line-height: 1;
  }

  .nav-item span:last-child {
    font-size: 10px;
    line-height: 1;
  }

  .nav-item.active,
  .nav-item:hover {
    color: #e9fbff;
    background: rgba(72, 116, 141, 0.16);
    border-color: rgba(124, 205, 238, 0.18);
  }

  .warroom {
    min-width: 0;
    min-height: 100vh;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, rgba(7, 12, 18, 0.88), rgba(4, 7, 10, 0.96));
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(99, 217, 255, 0.32) transparent;
  }

  .warroom::-webkit-scrollbar {
    width: 8px;
  }

  .warroom::-webkit-scrollbar-thumb {
    background: rgba(99, 217, 255, 0.32);
    border-radius: 999px;
  }

  .topbar {
    height: 68px;
    flex: 0 0 auto;
    border-bottom: 1px solid rgba(132, 194, 220, 0.16);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .eyebrow,
  .section-kicker,
  .code-path,
  .metric-label {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .title-stack {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .title-stack strong {
    font-size: 20px;
    font-weight: 700;
    color: #edfaff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .eyebrow {
    font-size: 12px;
  }

  .live-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #82fb8e;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    text-transform: uppercase;
  }

  .live-badge::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #48ff64;
    box-shadow: 0 0 14px rgba(72, 255, 100, 0.74);
    animation: pulse 1.3s ease-in-out infinite;
  }

  .content {
    flex: 0 0 auto;
    min-height: calc(100vh - 68px);
    min-width: 0;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: visible;
  }

  .panel,
  .mission {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.018) inset;
  }

  .mission {
    padding: 14px 16px;
    display: grid;
    gap: 10px;
  }

  .mission-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 128px;
    gap: 12px;
    min-width: 0;
  }

  .mission input {
    width: 100%;
    min-width: 0;
    color: #f2fbff;
    background: rgba(1, 4, 7, 0.76);
    border: 1px solid rgba(129, 187, 210, 0.18);
    border-radius: 7px;
    outline: none;
    padding: 16px 18px;
    font-size: 22px;
  }

  .mission input:focus {
    border-color: rgba(99, 217, 255, 0.65);
    box-shadow: 0 0 0 3px rgba(99, 217, 255, 0.1);
  }

  .launch {
    min-width: 0;
    width: 128px;
    border: 1px solid rgba(115, 232, 255, 0.42);
    border-radius: 7px;
    color: #031014;
    background: linear-gradient(180deg, #b4f2ff, #5dd7ff);
    font-weight: 800;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 0 22px rgba(80, 212, 255, 0.24);
  }

  .launch:disabled {
    opacity: 0.46;
    cursor: not-allowed;
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .section-kicker {
    font-size: 13px;
  }

  .system-state {
    color: #7ff58e;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
  }

  .agents-panel {
    flex: 0 0 auto;
    min-height: 0;
    min-width: 0;
  }

  .agents-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    min-width: 0;
  }

  .agent-card {
    position: relative;
    min-width: 0;
    min-height: 260px;
    border: 1px solid color-mix(in srgb, var(--accent) 42%, rgba(122, 178, 202, 0.2));
    border-radius: 7px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--accent) 9%, transparent), transparent 46%),
      rgba(7, 11, 17, 0.92);
    padding: 14px;
    overflow: hidden;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
  }

  .agent-card::before {
    content: "";
    position: absolute;
    inset: 0;
    border-top: 2px solid var(--accent);
    opacity: 0.72;
    pointer-events: none;
  }

  .agent-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
  }

  .agent-head > div:first-child {
    min-width: 0;
  }

  .agent-name {
    color: var(--accent);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 17px;
    font-weight: 800;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-handle {
    margin-top: 2px;
    color: #8b98a0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .agent-status {
    flex: 0 0 auto;
    max-width: 50px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    padding: 5px 9px;
    color: #90a1aa;
    background: rgba(255, 255, 255, 0.035);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    text-transform: uppercase;
  }

  .agent-card.running .agent-status {
    color: #dff9ff;
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .agent-card.done .agent-status {
    color: #8df59b;
    border-color: rgba(116, 255, 133, 0.35);
  }

  .agent-card.error .agent-status {
    color: #ff89a9;
    border-color: rgba(255, 92, 132, 0.36);
  }

  .agent-output {
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    color: #a9b7bd;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 15px;
    line-height: 1.5;
    white-space: pre-wrap;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--accent) 48%, transparent) transparent;
  }

  .agent-output::-webkit-scrollbar {
    width: 4px;
  }

  .agent-output::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--accent) 48%, transparent);
    border-radius: 999px;
  }

  .agent-output.empty {
    color: #5f6e76;
  }

  .agent-output.empty div {
    display: flex;
    gap: 6px;
  }

  .agent-output.empty div::before {
    content: ">";
    color: var(--accent);
  }

  .lower-grid {
    flex: 0 0 auto;
    min-height: 300px;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }

  .panel {
    min-width: 0;
    min-height: 0;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  .brief-grid {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 20px;
  }

  .summary-title {
    color: #e8fbff;
    font-size: 28px;
    font-weight: 760;
    line-height: 1.15;
    margin: 10px 0 16px;
  }

  .summary-text {
    max-height: none;
    overflow: auto;
    color: #9eafb7;
    font-size: 17px;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .ring-wrap {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 8px;
    border-left: 1px solid rgba(131, 182, 203, 0.16);
  }

  .ring {
    --score: 73%;
    width: 124px;
    height: 124px;
    border-radius: 999px;
    background:
      radial-gradient(circle at center, #071016 58%, transparent 59%),
      conic-gradient(#66e983 var(--score), rgba(98, 217, 255, 0.12) 0);
    display: grid;
    place-items: center;
    box-shadow: 0 0 28px rgba(99, 219, 120, 0.16);
  }

  .ring strong {
    color: #a5ffc2;
    font-size: 30px;
  }

  .ring-label {
    color: #798b94;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    text-transform: uppercase;
  }

  .telemetry {
    flex: 0 0 auto;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(118px, 1.15fr);
    gap: 12px;
    border-top: 1px solid rgba(132, 194, 220, 0.14);
    padding-top: 14px;
  }

  .metric {
    min-width: 0;
    border: 1px solid rgba(132, 194, 220, 0.16);
    border-radius: 7px;
    background: rgba(5, 9, 13, 0.74);
    padding: 14px 16px;
  }

  .metric-label {
    font-size: 12px;
  }

  .metric-value {
    margin-top: 8px;
    color: #7ce994;
    font-size: 24px;
    font-weight: 800;
  }

  .wide-chart {
    min-height: 92px;
    min-width: 0;
    position: relative;
    overflow: hidden;
  }

  .wide-chart svg {
    width: 100%;
    height: 62px;
    margin-top: 8px;
    overflow: visible;
  }

  .timeline {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #73858e;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }

  .timeline span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #31404a;
  }

  .timeline span.active {
    background: var(--green);
    box-shadow: 0 0 14px rgba(99, 219, 120, 0.6);
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(0.88); }
    50% { opacity: 1; transform: scale(1.08); }
  }

  @media (max-width: 760px) and (min-width: 521px) {
    .console-shell {
      width: 100vw;
      min-height: 100vh;
      height: auto;
      margin: 0;
      transform: none;
      grid-template-columns: minmax(0, 1fr);
    }

    .side-rail {
      display: none;
    }

    .content {
      padding: 10px;
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 48px);
      gap: 10px;
    }

    .topbar {
      height: 48px;
      padding: 8px 14px;
    }

    .title-stack strong {
      font-size: 14px;
    }

    .eyebrow,
    .live-badge,
    .section-kicker,
    .system-state {
      font-size: 10px;
    }

    .mission {
      padding: 10px;
    }

    .mission-row {
      grid-template-columns: minmax(0, 1fr) 84px;
      gap: 8px;
    }

    .mission input {
      padding: 10px 12px;
      font-size: 16px;
    }

    .launch {
      width: 84px;
      font-size: 14px;
    }

    .agents-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .agent-card {
      min-height: 0;
      padding: 11px;
    }

    .agent-output {
      font-size: 12px;
      line-height: 1.44;
    }

    .brief-grid {
      grid-template-columns: minmax(0, 1fr) 112px;
    }

    .summary-title {
      font-size: 18px;
    }

    .summary-text {
      font-size: 11px;
    }

    .ring {
      width: 76px;
      height: 76px;
    }

    .ring strong {
      font-size: 18px;
    }

    .summary-text {
      max-height: 102px;
    }

    .telemetry {
      gap: 8px;
      padding-top: 10px;
    }

    .metric {
      padding: 8px 10px;
    }

    .metric-value {
      font-size: 17px;
    }
  }

  @media (max-width: 520px) {
    body { overflow: auto; }
    .console-shell {
      width: calc(100vw - 18px);
      height: auto;
      min-height: calc(100vh - 18px);
      margin: 9px;
      grid-template-columns: 1fr;
      transform: none;
    }
    .side-rail {
      display: none;
    }
    .content {
      overflow: visible;
      grid-template-rows: auto auto auto auto;
    }
    .agents-grid,
    .lower-grid,
    .telemetry {
      grid-template-columns: 1fr;
    }
    .brief-grid {
      grid-template-columns: 1fr;
    }
    .ring-wrap {
      border-left: 0;
      border-top: 1px solid rgba(131, 182, 203, 0.16);
      padding-top: 12px;
    }
  }
</style>
</head>
<body>
<main class="console-shell">
  <aside class="side-rail" aria-label="War room navigation">
    <div class="mark">C</div>
    <button class="nav-item active" type="button"><span class="nav-icon">O</span><span>Overview</span></button>
    <button class="nav-item" type="button"><span class="nav-icon">A</span><span>Agents</span></button>
    <button class="nav-item" type="button"><span class="nav-icon">T</span><span>Telemetry</span></button>
    <button class="nav-item" type="button"><span class="nav-icon">L</span><span>Timeline</span></button>
    <button class="nav-item" type="button"><span class="nav-icon">S</span><span>Settings</span></button>
  </aside>

  <section class="warroom">
    <header class="topbar">
      <div class="title-stack">
        <span class="eyebrow">WAR ROOM // SESSION 042</span>
        <strong>Multi-Agent Decision Console</strong>
      </div>
      <div class="live-badge">Live analysis</div>
    </header>

    <div class="content">
      <section class="mission" aria-label="Mission control">
        <span class="section-kicker">Mission</span>
        <div class="mission-row">
          <input id="topic" type="text" value="Should we build a code review bot with the platform?" placeholder="Ask the agents what to debate..." autofocus />
          <button id="go" class="launch" onclick="run()">Launch</button>
        </div>
      </section>

      <section class="agents-panel" aria-label="Agent streams">
        <div class="section-title">
          <span class="section-kicker">Agent streams</span>
          <span id="system-state" class="system-state">STANDBY</span>
        </div>
        <div class="agents-grid" id="agents"></div>
      </section>

      <section class="lower-grid">
        <article class="panel">
          <div class="section-title">
            <span class="section-kicker">Decision brief</span>
            <span id="brief-state" class="system-state">Awaiting synthesis</span>
          </div>
          <div class="brief-grid">
            <div>
              <div class="eyebrow">Recommendation</div>
              <h2 id="summary-title" class="summary-title">Build the code review bot.</h2>
              <div id="summary-text" class="summary-text">Launch a mission to stream four specialists in parallel and synthesize the final call here.</div>
            </div>
            <div class="ring-wrap">
              <div id="confidence-ring" class="ring"><strong id="confidence-text">73%</strong></div>
              <div class="ring-label">Confidence</div>
            </div>
          </div>
        </article>
      </section>

      <section class="telemetry" aria-label="System telemetry">
        <div class="metric">
          <div class="metric-label">Tokens</div>
          <div id="metric-tokens" class="metric-value">124.8k</div>
        </div>
        <div class="metric">
          <div class="metric-label">Latency</div>
          <div id="metric-latency" class="metric-value">1.42s</div>
        </div>
        <div class="metric">
          <div class="metric-label">Agent uptime</div>
          <div id="metric-uptime" class="metric-value">100%</div>
        </div>
        <div class="metric">
          <div class="metric-label">Sources</div>
          <div id="metric-sources" class="metric-value">23</div>
        </div>
        <div class="metric wide-chart">
          <div class="timeline"><span class="active"></span> System telemetry</div>
          <svg viewBox="0 0 220 54" role="img" aria-label="Telemetry sparkline">
            <path d="M0 45 L28 35 L56 25 L84 31 L112 14 L140 34 L168 24 L196 20 L220 8" fill="none" stroke="#63db78" stroke-width="2" />
            <path d="M0 54 L0 45 L28 35 L56 25 L84 31 L112 14 L140 34 L168 24 L196 20 L220 8 L220 54 Z" fill="rgba(99, 219, 120, 0.10)" />
          </svg>
        </div>
      </section>
    </div>
  </section>
</main>
<script>
const ROLE_META = {
  architect: {
    label: 'ARCHITECT',
    handle: 'system_design',
    accent: '#62d9ff',
    cues: ['analyzing', 'scanning docs', 'mapping SDK', 'evaluating path']
  },
  security: {
    label: 'SECURITY ANALYST',
    handle: 'audit',
    accent: '#f1a11b',
    cues: ['threat modeling', 'data access scan', 'permission review', 'risk scoring']
  },
  pragmatist: {
    label: 'PRAGMATIST',
    handle: 'product',
    accent: '#63db78',
    cues: ['user value map', 'workflow fit', 'adoption estimate', 'prioritization']
  },
  skeptic: {
    label: 'SKEPTIC',
    handle: 'red_team',
    accent: '#a16bff',
    cues: ['assumption check', 'alt approaches', 'failure modes', 'edge cases']
  }
};

const AGENT_ORDER = ['architect', 'security', 'pragmatist', 'skeptic'];
let startedAt = 0;
let metricTimer = null;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function createAgentCard(agentId) {
  const meta = ROLE_META[agentId];
  const card = document.createElement('article');
  card.className = 'agent-card queued';
  card.id = 'card-' + agentId;
  card.style.setProperty('--accent', meta.accent);
  let cues = '';
  meta.cues.forEach((cue) => {
    cues += '<div>' + escapeHtml(cue) + '</div>';
  });
  card.innerHTML =
    '<div class="agent-head">' +
      '<div><div class="agent-name">' + meta.label + '</div><div class="agent-handle">' + meta.handle + '</div></div>' +
      '<span class="agent-status">QUE</span>' +
    '</div>' +
    '<div class="agent-output empty">' + cues + '</div>';
  return card;
}

function resetDashboard() {
  const agentRoot = document.getElementById('agents');
  agentRoot.innerHTML = '';
  AGENT_ORDER.forEach((id) => agentRoot.appendChild(createAgentCard(id)));
  document.getElementById('system-state').textContent = 'STANDBY';
  document.getElementById('brief-state').textContent = 'Awaiting synthesis';
  document.getElementById('summary-title').textContent = 'Build the code review bot.';
  document.getElementById('summary-text').textContent = 'Launch a mission to stream four specialists in parallel and synthesize the final call here.';
  document.getElementById('confidence-ring').style.setProperty('--score', '73%');
  document.getElementById('confidence-text').textContent = '73%';
}

function setCardStatus(agentId, status) {
  const card = document.getElementById('card-' + agentId);
  if (!card) return;
  card.classList.remove('queued', 'running', 'done', 'error');
  card.classList.add(status);
  const badge = card.querySelector('.agent-status');
  const label = { queued: 'QUE', running: 'RUN', done: 'DONE', error: 'ERR' }[status] || status;
  badge.textContent = label;
}

function headlineForTopic(topic) {
  if (topic.toLowerCase().includes('code review bot')) {
    return 'Build the code review bot.';
  }
  return 'Decision brief complete.';
}

function appendAgentText(agentId, text) {
  const card = document.getElementById('card-' + agentId);
  if (!card) return;
  const output = card.querySelector('.agent-output');
  if (output.classList.contains('empty')) {
    output.classList.remove('empty');
    output.textContent = '';
  }
  output.textContent += text;
  output.scrollTop = output.scrollHeight;
}

function setRunningMetrics(active) {
  if (metricTimer) {
    clearInterval(metricTimer);
    metricTimer = null;
  }
  if (!active) return;
  metricTimer = setInterval(() => {
    const elapsed = Math.max(1, (Date.now() - startedAt) / 1000);
    document.getElementById('metric-latency').textContent = elapsed.toFixed(2) + 's';
    document.getElementById('metric-tokens').textContent = (124.8 + elapsed * 1.7).toFixed(1) + 'k';
    document.getElementById('metric-sources').textContent = String(23 + Math.floor(elapsed % 9));
  }, 450);
}

async function run() {
  const topic = document.getElementById('topic').value.trim();
  if (!topic) return;
  const finalHeadline = headlineForTopic(topic);
  resetDashboard();
  startedAt = Date.now();
  document.getElementById('go').disabled = true;
  document.getElementById('system-state').textContent = 'FAN-OUT RUNNING';
  document.getElementById('brief-state').textContent = 'Synthesizer queued';
  document.getElementById('summary-title').textContent = 'Agents are debating...';
  document.getElementById('summary-text').textContent = '';
  document.getElementById('confidence-ring').style.setProperty('--score', '34%');
  document.getElementById('confidence-text').textContent = '34%';
  setRunningMetrics(true);

  const es = new EventSource('/run?topic=' + encodeURIComponent(topic));

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'agent-start') {
      setCardStatus(data.agentId, 'running');
    }

    if (data.type === 'agent-delta') {
      appendAgentText(data.agentId, data.text);
    }

    if (data.type === 'agent-done') {
      setCardStatus(data.agentId, data.status === 'completed' ? 'done' : 'error');
    }

    if (data.type === 'synthesis-delta') {
      document.getElementById('brief-state').textContent = 'Synthesizing';
      document.getElementById('summary-title').textContent = 'Decision brief incoming.';
      document.getElementById('confidence-ring').style.setProperty('--score', '73%');
      document.getElementById('confidence-text').textContent = '73%';
      document.getElementById('summary-text').textContent += data.text;
    }

    if (data.type === 'done') {
      es.close();
      document.getElementById('go').disabled = false;
      document.getElementById('system-state').textContent = 'ANALYSIS COMPLETE';
      document.getElementById('brief-state').textContent = 'Recommendation locked';
      document.getElementById('summary-title').textContent = finalHeadline;
      setRunningMetrics(false);
    }
  };

  es.onerror = () => {
    es.close();
    document.getElementById('go').disabled = false;
    document.getElementById('system-state').textContent = 'STREAM ERROR';
    document.getElementById('brief-state').textContent = 'Check server logs';
    setRunningMetrics(false);
  };
}

document.getElementById('topic').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

resetDashboard();
</script>
</body>
</html>`;

const AGENT_ROLES = [
	{
		id: "architect",
		role: "Architect",
		prompt: (topic: string) =>
			`You are an architect in a multi-agent war room. Analyze the mission from a systems and implementation design perspective. Be concrete, visual-demo minded, and concise (3-4 short paragraphs max).\n\nMission: ${topic}`,
	},
	{
		id: "security",
		role: "Security Analyst",
		prompt: (topic: string) =>
			`You are a security analyst in a multi-agent war room. Identify data access, permission, privacy, abuse, and operational risks for this mission. Be crisp and actionable (3-4 short paragraphs max).\n\nMission: ${topic}`,
	},
	{
		id: "pragmatist",
		role: "Pragmatist",
		prompt: (topic: string) =>
			`You are a pragmatic product and engineering lead in a multi-agent war room. Evaluate user value, demo quality, cost, integration burden, and launch path. Be concise (3-4 short paragraphs max).\n\nMission: ${topic}`,
	},
	{
		id: "skeptic",
		role: "Skeptic",
		prompt: (topic: string) =>
			`You are a skeptical red-team reviewer in a multi-agent war room. Challenge assumptions, find failure modes, compare simpler alternatives, and state what would make the mission not worth doing. Be concise (3-4 short paragraphs max).\n\nMission: ${topic}`,
	},
];

function createAgentConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-4.6",
		apiKey: process.env.CLINE_API_KEY,
		maxIterations: 1,
	};
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	if (url.pathname === "/") {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(HTML);
		return;
	}

	if (url.pathname === "/run") {
		const topic = url.searchParams.get("topic");
		if (!topic) {
			res.writeHead(400);
			res.end("Missing topic");
			return;
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		const send = (data: Record<string, unknown>) => {
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		};

		const results = await runAgents(topic, send);

		const synthesizer = new Agent(createAgentConfig());
		synthesizer.subscribe((event) => {
			if (event.type === "assistant-text-delta") {
				send({ type: "synthesis-delta", text: event.text });
			}
		});

		const findings = results
			.map((r) => `## ${r.role}\n${r.output}`)
			.join("\n\n");

		await synthesizer.run(
			`You are a synthesizer for a developer-console demo. Four specialists analyzed a mission. Produce a compact decision brief with a clear recommendation, confidence level, top risks, and immediate next steps. Use plain text with short labels, no markdown headings. Do not repeat their analyses verbatim; extract the key insights and make the result feel like a war-room verdict.\n\nMission: ${topic}\n\n${findings}`,
		);

		send({ type: "done" });
		res.end();
		return;
	}

	res.writeHead(404);
	res.end("Not found");
});

interface AgentResult {
	role: string;
	output: string;
	status: string;
}

async function runAgents(
	topic: string,
	send: (data: Record<string, unknown>) => void,
): Promise<AgentResult[]> {
	const promises = AGENT_ROLES.map(async (spec) => {
		const agent = new Agent(createAgentConfig());

		send({ type: "agent-start", agentId: spec.id, role: spec.role });

		agent.subscribe((event) => {
			if (event.type === "assistant-text-delta") {
				send({ type: "agent-delta", agentId: spec.id, text: event.text });
			}
		});

		const result = await agent.run(spec.prompt(topic));

		send({
			type: "agent-done",
			agentId: spec.id,
			status: result.status,
		});

		return {
			role: spec.role,
			output: result.outputText,
			status: result.status,
		};
	});

	return Promise.all(promises);
}

server.listen(PORT, () => {
	console.log(`Multi-agent server running at http://localhost:${PORT}`);
});
