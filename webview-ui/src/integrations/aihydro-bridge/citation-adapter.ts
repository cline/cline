/**
 * AI-Hydro Bridge — Citation Adapter (Phase 3)
 *
 * Exports `AIHYDRO_BRIDGE_CITATION_SCRIPT`: an inline IIFE injected into every
 * module iframe.  Activates only when `<cite data-aihydro-cite-key>` elements
 * exist — zero overhead otherwise.
 *
 * Author contract (what the agent writes in a module):
 * ─────────────────────────────────────────────────────
 *   <cite data-aihydro-cite-key="doi:10.1080/02626667909491834">
 *     Beven & Kirkby, 1979
 *   </cite>
 *
 *   The cite-key format is "doi:<DOI>".  The adapter reads the citation from
 *   the module's embedded citation registry (set by the agent) and renders:
 *     - An inline styled <cite> with a subtle underline
 *     - A hover popover with the full APA string + DOI link
 *     - Auto-collects all cites into a <section id="aihydro-references"> at
 *       the end of the document (numbered list, APA format)
 *
 * Citation data is embedded by the agent as an inline script:
 *   <script id="aihydro-citations" type="application/json">
 *     {
 *       "doi:10.1080/02626667909491834": {
 *         "doi": "10.1080/02626667909491834",
 *         "formatted_apa": "Beven, K.J., & Kirkby, M.J. (1979)...",
 *         "short": "Beven & Kirkby (1979)"
 *       }
 *     }
 *   </script>
 *
 * The agent MUST call lookup_citation() to populate this registry.  If a DOI
 * is not in the registry, the adapter shows "citation not verified" in the popover.
 */

export const AIHYDRO_BRIDGE_CITATION_SCRIPT = `
<script id="aihydro-bridge-citation">
(function () {
  'use strict';

  // ── Citation registry ──────────────────────────────────────────────────
  var _registry = {};

  function loadRegistry() {
    var el = document.getElementById('aihydro-citations');
    if (!el) return;
    try {
      _registry = JSON.parse(el.textContent || '{}');
    } catch (e) {
      console.warn('[aihydro-bridge/citation] Registry parse error:', e);
    }
  }

  // ── Popover styles (injected once) ─────────────────────────────────────
  var _stylesInjected = false;
  function ensureStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var s = document.createElement('style');
    s.id = 'aihydro-citation-style';
    s.textContent = [
      'cite[data-aihydro-cite-key] {',
      '  font-style: normal;',
      '  border-bottom: 1px dotted rgba(0,221,255,0.6);',
      '  cursor: help;',
      '  color: inherit;',
      '  position: relative;',
      '  display: inline;',
      '}',
      'cite[data-aihydro-cite-key] sup {',
      '  font-size: 0.7em;',
      '  color: #00DDFF;',
      '  margin-left: 1px;',
      '}',
      '.aihydro-cite-popover {',
      '  position: fixed;',
      '  z-index: 99999;',
      '  max-width: 380px;',
      '  background: rgba(15,15,30,0.97);',
      '  border: 1px solid rgba(0,221,255,0.45);',
      '  border-radius: 12px;',
      '  padding: 14px 16px;',
      '  font-family: Nunito, system-ui, sans-serif;',
      '  font-size: 13px;',
      '  line-height: 1.5;',
      '  color: #7dd3fc;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,221,255,0.1);',
      '  pointer-events: none;',
      '}',
      '.aihydro-cite-popover .cite-apa {',
      '  margin-bottom: 8px;',
      '  color: #cbd5e1;',
      '}',
      '.aihydro-cite-popover .cite-doi {',
      '  font-size: 11px;',
      '  color: #00DDFF;',
      '  opacity: 0.85;',
      '  word-break: break-all;',
      '}',
      '.aihydro-cite-popover .cite-unverified {',
      '  color: #fbbf24;',
      '  font-size: 11px;',
      '}',
      '#aihydro-references {',
      '  margin-top: 40px;',
      '  padding-top: 24px;',
      '  border-top: 1px solid rgba(125,211,252,0.18);',
      '}',
      '#aihydro-references h2 {',
      '  font-size: 18px;',
      '  color: #7dd3fc;',
      '  margin-bottom: 14px;',
      '  font-family: Poppins, system-ui, sans-serif;',
      '}',
      '#aihydro-references ol {',
      '  padding-left: 20px;',
      '  margin: 0;',
      '}',
      '#aihydro-references li {',
      '  margin-bottom: 10px;',
      '  color: #94a3b8;',
      '  font-size: 13px;',
      '  line-height: 1.5;',
      '}',
      '#aihydro-references li a {',
      '  color: #00DDFF;',
      '  text-decoration: none;',
      '}',
    ].join('\\n');
    document.head.appendChild(s);
  }

  // ── Popover singleton ─────────────────────────────────────────────────
  var _popover = null;
  function getPopover() {
    if (!_popover) {
      _popover = document.createElement('div');
      _popover.className = 'aihydro-cite-popover';
      _popover.style.display = 'none';
      document.body.appendChild(_popover);
    }
    return _popover;
  }

  function showPopover(el, data) {
    var pop = getPopover();
    var doi = data ? data.doi : null;
    var apa = data ? data.formatted_apa : null;
    if (!data) {
      pop.innerHTML =
        '<div class="cite-unverified">⚠ Citation not verified — call lookup_citation() and embed result in the module.</div>';
    } else {
      var doiHtml = doi
        ? '<div class="cite-doi"><a href="https://doi.org/' + doi + '" target="_blank">https://doi.org/' + doi + '</a></div>'
        : '';
      pop.innerHTML = '<div class="cite-apa">' + (apa || '') + '</div>' + doiHtml;
    }
    pop.style.display = 'block';

    var rect = el.getBoundingClientRect();
    var top = rect.bottom + 6;
    var left = rect.left;
    if (left + 380 > window.innerWidth) {
      left = Math.max(8, window.innerWidth - 388);
    }
    if (top + 160 > window.innerHeight) {
      top = rect.top - 160;
    }
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function hidePopover() {
    if (_popover) _popover.style.display = 'none';
  }

  // ── Citation number tracking ───────────────────────────────────────────
  var _citeOrder = [];
  var _citeNums = {};

  function getCiteNum(key) {
    if (!(_citeNums[key] >= 1)) {
      _citeOrder.push(key);
      _citeNums[key] = _citeOrder.length;
    }
    return _citeNums[key];
  }

  // ── Wire up a single <cite> element ───────────────────────────────────
  function initCite(el) {
    var key = el.getAttribute('data-aihydro-cite-key') || '';
    var data = _registry[key] || null;
    var num = getCiteNum(key);

    // Append superscript number
    var sup = document.createElement('sup');
    sup.textContent = String(num);
    el.appendChild(sup);

    // Hover events
    el.addEventListener('mouseenter', function () { showPopover(el, data); });
    el.addEventListener('mouseleave', hidePopover);
    el.setAttribute('data-aihydro-cite-ready', 'true');
  }

  // ── Build references section ───────────────────────────────────────────
  function buildReferenceSection() {
    if (_citeOrder.length === 0) return;
    var existing = document.getElementById('aihydro-references');
    if (existing) existing.remove();

    var section = document.createElement('section');
    section.id = 'aihydro-references';
    var h2 = document.createElement('h2');
    h2.textContent = 'References';
    section.appendChild(h2);

    var ol = document.createElement('ol');
    _citeOrder.forEach(function (key) {
      var data = _registry[key];
      var li = document.createElement('li');
      if (data && data.formatted_apa) {
        var doi = data.doi;
        var apa = data.formatted_apa;
        if (doi && !apa.includes('doi.org')) {
          apa += ' <a href="https://doi.org/' + doi + '" target="_blank">https://doi.org/' + doi + '</a>';
        } else if (doi) {
          apa = apa.replace(
            'https://doi.org/' + doi,
            '<a href="https://doi.org/' + doi + '" target="_blank">https://doi.org/' + doi + '</a>'
          );
        }
        li.innerHTML = apa;
      } else {
        li.innerHTML = '<span style="color:#fbbf24">⚠ Unverified citation: ' + key + '</span>';
      }
      ol.appendChild(li);
    });
    section.appendChild(ol);
    document.body.appendChild(section);
  }

  // ── Register with the AI-Hydro Bridge ─────────────────────────────────
  function init() {
    loadRegistry();
    ensureStyles();

    if (window.__aihydroBridge) {
      window.__aihydroBridge.registerAdapter(
        'cite[data-aihydro-cite-key]:not([data-aihydro-cite-ready])',
        initCite
      );
    } else {
      // Standalone fallback
      var handler = function () {
        document.querySelectorAll('cite[data-aihydro-cite-key]').forEach(initCite);
        buildReferenceSection();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handler);
      } else {
        handler();
      }
    }

    // Build references section after DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildReferenceSection);
    } else {
      // Defer to let the bridge scan run first
      setTimeout(buildReferenceSection, 200);
    }
  }

  init();
})();
</script>
`
