/**
 * Leaflet/Folium sizing normalizer for HTML Preview iframes.
 *
 * Folium exports are generated for a top-level browser document. Inside an
 * iframe in VS Code the document can load while its map container is still
 * measuring as 0px, or before the iframe has finished settling in the panel.
 * Leaflet then creates the map but it never lays out tiles until
 * `invalidateSize()` is called.
 *
 * This shim is intentionally narrow: it only touches pages with Folium/Leaflet
 * containers and leaves ordinary HTML pages alone.
 *
 * In Phase 2 (standardized maps) this normalizer becomes a plugin on the
 * AI-Hydro Bridge core; for now it lives as a single exported pair of strings
 * so the call sites in HtmlPreviewView can stay slim.
 */

export const LEAFLET_NORMALIZER_STYLE = `<style id="aihydro-leaflet-normalizer">
html:has(.folium-map),
body:has(.folium-map) {
  width: 100% !important;
  height: 100% !important;
  min-height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}
body:has(.folium-map) > .folium-map,
.folium-map {
  width: 100vw !important;
  height: 100vh !important;
  min-height: 100vh !important;
}
.folium-map.leaflet-container,
.leaflet-container {
  background: #e5e3df !important;
}
</style>`

export const LEAFLET_NORMALIZER_SCRIPT = `<script>(function(){
  function invalidateLeafletMaps() {
    // NEVER do bare Object.keys(window) + window[k]: VS Code webviews expose
    // cross-origin nested Window proxies on window; reading properties throws
    // SecurityError before we can typeof-check them.
    Object.keys(window).forEach(function(k) {
      var v;
      try {
        v = window[k];
      } catch (_) {
        return;
      }
      if (!v || typeof v !== 'object') return;
      try {
        if (typeof v.invalidateSize === 'function') {
          v.invalidateSize(true);
        }
      } catch (_) {}
    });
  }
  function normalizeLeaflet() {
    try {
      var maps = Array.prototype.slice.call(document.querySelectorAll('.folium-map'));
      if (!maps.length) return;
      document.documentElement.style.width = '100%';
      document.documentElement.style.height = '100%';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      maps.forEach(function(el) {
        el.style.width = '100vw';
        el.style.height = '100vh';
        el.style.minHeight = '100vh';
      });
      invalidateLeafletMaps();
    } catch (e) {
      try { console.error('AI-Hydro Leaflet normalizer failed', e); } catch (_) {}
    }
  }
  window.__aihydroNormalizeLeaflet = normalizeLeaflet;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', normalizeLeaflet);
  } else {
    normalizeLeaflet();
  }
  window.addEventListener('load', normalizeLeaflet);
  setTimeout(normalizeLeaflet, 50);
  setTimeout(normalizeLeaflet, 250);
  setTimeout(normalizeLeaflet, 1000);
  setTimeout(normalizeLeaflet, 2500);
})();</script>`
