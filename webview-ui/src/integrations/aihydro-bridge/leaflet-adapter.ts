/**
 * AI-Hydro Bridge — Leaflet Adapter (Phase 2)
 *
 * Exports `AIHYDRO_BRIDGE_LEAFLET_SCRIPT`: an inline IIFE injected into every
 * module iframe.  It activates only when a `data-aihydro-map` element is
 * found — there is zero overhead in modules that have no maps.
 *
 * Author contract (what the agent writes in a module):
 * ─────────────────────────────────────────────────────
 *   <div class="aihydro-map"
 *        data-aihydro-map-id="watershed-huc02-11"
 *        data-basemap="usgs-topo"
 *        data-initial-zoom="10"
 *        style="width:100%; height:600px;">
 *     <script type="application/geo+json">
 *       { "type": "FeatureCollection", "features": [...] }
 *     </script>
 *   </div>
 *
 * Supported data-basemap values:
 *   usgs-topo (default), usgs-imagery, esri-satellite, carto-dark, osm
 *
 * Optional data-* attributes:
 *   data-initial-zoom        — numeric zoom level (default: auto-fit)
 *   data-center-lat/lng      — centre override (default: computed from GeoJSON)
 *   data-marker-lat/lng      — optional pin with popup text from data-marker-label
 *   data-gauge-id            — USGS gauge ID shown in the auto-generated popup
 *   data-style-color         — boundary stroke colour (default: #00DDFF)
 *   data-style-fill          — fill colour (default: #00A3FF)
 *   data-style-fill-opacity  — fill opacity (default: 0.08)
 *
 * Leaflet is loaded from jsDelivr CDN on first use if not already present.
 * (Vendored offline distribution is planned for a follow-up release.)
 */

const LEAFLET_CDN_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js"
const LEAFLET_CDN_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css"

export const AIHYDRO_BRIDGE_LEAFLET_SCRIPT = `
<script id="aihydro-bridge-leaflet">
(function () {
  'use strict';

  // ── Basemap tile URL factory ────────────────────────────────────────────
  var BASEMAPS = {
    'usgs-topo': {
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
      attr: 'USGS | National Map',
      maxZoom: 16,
    },
    'usgs-imagery': {
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      attr: 'USGS | National Map',
      maxZoom: 16,
    },
    'esri-satellite': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr: '© Esri',
      maxZoom: 19,
    },
    'carto-dark': {
      url: 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
      attr: '© CARTO',
      maxZoom: 19,
    },
    'osm': {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '© OpenStreetMap',
      maxZoom: 19,
    },
  };

  // ── Dark-palette CSS injected once ─────────────────────────────────────
  var _leafletCssInjected = false;
  function ensureLeafletStyles() {
    if (_leafletCssInjected) return;
    _leafletCssInjected = true;
    // Dark palette overrides for AI-Hydro modules
    var style = document.createElement('style');
    style.id = 'aihydro-leaflet-dark';
    style.textContent = [
      '.leaflet-container { background: #0a0a15 !important; font-family: inherit; }',
      '.leaflet-control-attribution { background: rgba(10,10,21,0.85) !important; color: #94a3b8 !important; font-size: 10px !important; }',
      '.leaflet-control-attribution a { color: #00DDFF !important; }',
      '.leaflet-control-layers { background: rgba(26,26,46,0.92) !important; color: #7dd3fc !important; border: 1px solid rgba(125,211,252,0.18) !important; border-radius: 10px !important; }',
      '.leaflet-control-zoom a { background: rgba(26,26,46,0.92) !important; color: #00DDFF !important; border-color: rgba(125,211,252,0.18) !important; }',
      '.leaflet-popup-content-wrapper { background: rgba(15,15,30,0.95); color: #7dd3fc; border: 1px solid rgba(0,221,255,0.45); border-radius: 14px; }',
      '.leaflet-popup-tip { background: rgba(15,15,30,0.95); }',
      /* AI-Hydro watermark */
      '.aihydro-map-watermark { position: absolute; bottom: 6px; left: 6px; z-index: 1000; font-size: 10px; color: rgba(0,221,255,0.55); pointer-events: none; font-family: monospace; letter-spacing: 0.05em; }',
    ].join('\\n');
    document.head.appendChild(style);
  }

  // ── Leaflet loader — inject CDN once, then call back ───────────────────
  var _leafletLoaded = typeof window.L !== 'undefined';
  var _leafletCallbacks = [];
  var _leafletLoading = false;

  function whenLeafletReady(cb) {
    if (_leafletLoaded) { cb(); return; }
    _leafletCallbacks.push(cb);
    if (_leafletLoading) return;
    _leafletLoading = true;

    // CSS
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '${LEAFLET_CDN_CSS}';
    document.head.appendChild(link);

    // JS
    var script = document.createElement('script');
    script.src = '${LEAFLET_CDN_JS}';
    script.onload = function () {
      _leafletLoaded = true;
      _leafletCallbacks.forEach(function (fn) { try { fn(); } catch(e){} });
      _leafletCallbacks = [];
    };
    script.onerror = function () {
      console.error('[aihydro-bridge] Failed to load Leaflet from CDN');
    };
    document.head.appendChild(script);
  }

  // ── Parse inline GeoJSON from <script type="application/geo+json"> ─────
  function parseInlineGeoJSON(container) {
    var scriptEl = container.querySelector('script[type="application/geo+json"]');
    if (!scriptEl) return null;
    try {
      return JSON.parse(scriptEl.textContent || '');
    } catch (e) {
      console.warn('[aihydro-bridge] GeoJSON parse error:', e);
      return null;
    }
  }

  // ── Map initializer ────────────────────────────────────────────────────
  function initMap(el) {
    var mapId = el.getAttribute('data-aihydro-map-id') || ('map-' + Math.random().toString(36).slice(2));
    var basemapKey = el.getAttribute('data-basemap') || 'usgs-topo';
    var initialZoom = el.getAttribute('data-initial-zoom') ? parseInt(el.getAttribute('data-initial-zoom'), 10) : null;
    var centerLat = el.getAttribute('data-center-lat') ? parseFloat(el.getAttribute('data-center-lat')) : null;
    var centerLng = el.getAttribute('data-center-lng') ? parseFloat(el.getAttribute('data-center-lng')) : null;
    var markerLat = el.getAttribute('data-marker-lat') ? parseFloat(el.getAttribute('data-marker-lat')) : null;
    var markerLng = el.getAttribute('data-marker-lng') ? parseFloat(el.getAttribute('data-marker-lng')) : null;
    var markerLabel = el.getAttribute('data-marker-label') || '';
    var gaugeId = el.getAttribute('data-gauge-id') || '';
    var styleColor = el.getAttribute('data-style-color') || '#00DDFF';
    var styleFill = el.getAttribute('data-style-fill') || '#00A3FF';
    var styleFillOpacity = el.getAttribute('data-style-fill-opacity') ? parseFloat(el.getAttribute('data-style-fill-opacity')) : 0.08;

    var geojson = parseInlineGeoJSON(el);

    // Ensure the element itself has a proper height
    if (!el.style.height && !el.offsetHeight) {
      el.style.height = '480px';
    }

    ensureLeafletStyles();

    whenLeafletReady(function () {
      var L = window.L;
      var bm = BASEMAPS[basemapKey] || BASEMAPS['usgs-topo'];

      var mapCenter = [39.5, -98.0];
      var mapZoom = initialZoom || 5;

      if (centerLat !== null && centerLng !== null) {
        mapCenter = [centerLat, centerLng];
      }

      // Create the map
      var map = L.map(el, {
        center: mapCenter,
        zoom: mapZoom,
        zoomControl: true,
        attributionControl: true,
      });

      // Primary basemap
      var primaryLayer = L.tileLayer(bm.url, {
        attribution: bm.attr,
        maxZoom: bm.maxZoom,
      }).addTo(map);

      // Build overlay layers object
      var overlayLayers = {};

      // GeoJSON overlay
      if (geojson) {
        var geoLayer = L.geoJSON(geojson, {
          style: function (feature) {
            return {
              color: (feature && feature.properties && feature.properties.stroke) || styleColor,
              weight: 2.5,
              fillColor: (feature && feature.properties && feature.properties.fill) || styleFill,
              fillOpacity: styleFillOpacity,
            };
          },
          pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, {
              radius: 7,
              color: styleColor,
              weight: 2,
              fillColor: styleFill,
              fillOpacity: 0.6,
            });
          },
          onEachFeature: function (feature, layer) {
            if (feature.properties && feature.properties.name) {
              layer.bindTooltip(String(feature.properties.name), { sticky: true });
            }
          },
        }).addTo(map);

        overlayLayers['Boundary'] = geoLayer;

        // Auto-fit unless caller specified an explicit center+zoom
        if (centerLat === null || centerLng === null) {
          try {
            var bounds = geoLayer.getBounds();
            if (bounds.isValid()) {
              if (initialZoom) {
                map.setView(bounds.getCenter(), initialZoom);
              } else {
                map.fitBounds(bounds, { padding: [20, 20] });
              }
            }
          } catch (e) { /* non-fatal */ }
        }
      }

      // Optional pin marker
      if (markerLat !== null && markerLng !== null) {
        var markerIcon = L.divIcon({
          className: '',
          iconSize: [22, 22],
          html: '<div style="width:22px;height:22px;border-radius:50%;border:3px solid ' + styleColor + ';background:rgba(0,221,255,0.35);box-shadow:0 0 16px rgba(0,221,255,0.65);"></div>',
        });
        var pin = L.marker([markerLat, markerLng], { icon: markerIcon }).addTo(map);
        if (markerLabel || gaugeId) {
          var popupHtml = '<div style="min-width:160px">';
          if (markerLabel) popupHtml += '<strong>' + markerLabel + '</strong>';
          if (gaugeId) popupHtml += (markerLabel ? '<br>' : '') + 'USGS Gauge: ' + gaugeId;
          popupHtml += '</div>';
          pin.bindPopup(popupHtml);
        }
        overlayLayers['Gauge'] = L.layerGroup([pin]);
      }

      // Layer control (only when multiple layers exist)
      if (Object.keys(overlayLayers).length > 0) {
        var baseLayers = {};
        baseLayers[basemapKey === 'osm' ? 'OpenStreetMap' : basemapKey === 'carto-dark' ? 'Dark (CARTO)' : basemapKey === 'usgs-imagery' ? 'USGS Imagery' : basemapKey === 'esri-satellite' ? 'Satellite' : 'USGS Topo'] = primaryLayer;
        L.control.layers(baseLayers, overlayLayers, { position: 'topright', collapsed: true }).addTo(map);
      }

      L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

      // Watermark
      var wm = document.createElement('div');
      wm.className = 'aihydro-map-watermark';
      wm.textContent = 'AI-Hydro';
      el.style.position = 'relative';
      el.appendChild(wm);

      // Fix tile size after container settles
      setTimeout(function () { map.invalidateSize(); }, 250);

      // ── Report map load as a PreviewEvent ─────────────────────────────
      if (window.__aihydroBridge) {
        window.__aihydroBridge.reportEvent('map.event', {
          mapId: mapId,
          eventType: 'map.loaded',
          basemap: basemapKey,
          hasGeoJSON: !!geojson,
          featureCount: geojson && Array.isArray(geojson.features) ? geojson.features.length : 0,
        });
      }

      // Listen for user map interactions and forward to agent
      map.on('click', function (e) {
        if (window.__aihydroBridge) {
          window.__aihydroBridge.reportEvent('map.event', {
            mapId: mapId,
            eventType: 'map.click',
            lat: e.latlng ? e.latlng.lat : null,
            lng: e.latlng ? e.latlng.lng : null,
          });
        }
      });
      map.on('zoomend', function () {
        if (window.__aihydroBridge) {
          window.__aihydroBridge.reportEvent('map.event', {
            mapId: mapId,
            eventType: 'map.zoom',
            zoom: map.getZoom(),
          });
        }
      });

      // Store on element for external access
      el._aihydroMap = map;
      el.setAttribute('data-aihydro-map-ready', 'true');
    });
  }

  // ── Register with the AI-Hydro Bridge ──────────────────────────────────
  function register() {
    if (window.__aihydroBridge) {
      window.__aihydroBridge.registerAdapter('.aihydro-map[data-aihydro-map-id]', initMap);
    } else {
      // Standalone fallback: scan on DOMContentLoaded without the bridge
      var handler = function () {
        document.querySelectorAll('.aihydro-map[data-aihydro-map-id]').forEach(initMap);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handler);
      } else {
        handler();
      }
    }
  }

  register();
})();
</script>
`
