/**
 * AI-Hydro Bridge Core — injected into every HTML module iframe.
 *
 * Architecture
 * ─────────────
 * This file exports `AIHYDRO_BRIDGE_CORE_SCRIPT`: a self-contained IIFE
 * (< 2 KB) that, when injected into the iframe via srcdoc, sets up:
 *
 *   • `window.__aihydroBridge` — public API for adapters
 *       .registerAdapter(selector, initFn)  — register a data-aihydro-* adapter
 *       .reportEvent(kind, payload)          — fire a PreviewEvent to the host
 *       .getArtifactId()                     — the module's artifact ID
 *
 *   • A DOMContentLoaded + MutationObserver loop that fires each registered
 *     adapter against matching elements exactly once.
 *
 * Adapters (Phase 2: leaflet, Phase 3: citation, Phase 4: editor) import
 * this as a peer string export and are concatenated in HtmlPreviewView.tsx.
 *
 * Mirrored by the host-side PreviewSessionService (appendEvent) which writes
 * events to ~/.aihydro/preview_events/ for MCP tool consumption.
 */

export const AIHYDRO_BRIDGE_CORE_SCRIPT = `
<script id="aihydro-bridge-core">
(function () {
  'use strict';
  if (window.__aihydroBridge) return; // guard against double-injection

  var _adapters = []; // { selector: string, init: fn }
  var _seenElements = new WeakSet();

  // ── Public API ──────────────────────────────────────────────────────────
  window.__aihydroBridge = {
    /**
     * Register an adapter.
     * @param {string} selector  CSS selector for elements this adapter handles
     * @param {function} initFn  Called with each matching element (once)
     */
    registerAdapter: function (selector, initFn) {
      _adapters.push({ selector: selector, init: initFn });
    },

    /**
     * Report a PreviewEvent to the host (via postMessage → webview → host).
     * @param {string} kind    e.g. 'map.event', 'user.comment', 'edit.toggled'
     * @param {object} payload
     */
    reportEvent: function (kind, payload) {
      var artifactId = (window.__aihydroArtifact || {}).id || 'unknown';
      try {
        window.parent.postMessage({
          type: 'aihydro-preview-event',
          kind: kind,
          moduleId: artifactId,
          payloadJson: JSON.stringify(payload || {}),
          timestampMs: Date.now(),
          source: 'bridge',
        }, '*');
      } catch (e) { /* non-fatal */ }
    },

    /** Returns the current artifact/module ID. */
    getArtifactId: function () {
      return (window.__aihydroArtifact || {}).id || 'unknown';
    },
  };

  // ── Adapter scan ────────────────────────────────────────────────────────
  function scanOnce(root) {
    if (!root) return;
    _adapters.forEach(function (adapter) {
      var elements;
      try {
        elements = root.querySelectorAll(adapter.selector);
      } catch (e) { return; }
      elements.forEach(function (el) {
        if (_seenElements.has(el)) return;
        _seenElements.add(el);
        try {
          adapter.init(el);
        } catch (err) {
          console.warn('[aihydro-bridge] adapter init error:', err);
        }
      });
    });
  }

  function startObserver() {
    scanOnce(document);
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          scanOnce(node);
          // Also check within the added subtree
          scanOnce(node.parentElement || document);
        });
      });
    });
    obs.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
</script>
`
