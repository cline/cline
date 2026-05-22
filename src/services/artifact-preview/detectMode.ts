/**
 * Heuristics to decide whether an HTML artifact should be rendered with
 * scripts enabled (`interactive`) or as inert HTML (`safe`).
 *
 * Rationale: most HTML files users hand to AI-Hydro are research artifacts
 * produced by Folium, Leaflet, Plotly, Bokeh, ipywidgets, or generic
 * Jupyter `to_html` exports — all of which require JavaScript execution
 * AND external CDN scripts to be useful. Defaulting to safe mode for these
 * gives a worse-than-broken experience (a blank container where a map or
 * chart should be).
 *
 * We err on the side of `safe` only when:
 *   1. There is no <script> tag at all, AND
 *   2. There is no recognizable widget fingerprint, AND
 *   3. The file is small enough that we are confident the entire content was
 *      scanned (large files default to interactive — they probably matter).
 *
 * This module is intentionally string-based (no DOM parsing) so it works
 * identically on Node and in the webview, and so it cannot itself execute
 * untrusted script side-effects.
 */

const INTERACTIVE_FINGERPRINTS: ReadonlyArray<RegExp> = [
	/<script\b/i,
	/folium-map|folium\.Map|leaflet|L\.map\(|L\.tileLayer/i,
	/plotly(?:-latest|\.js|\.min)|Plotly\.newPlot|cdn\.plot\.ly/i,
	/bokeh(?:-\d|\.min)|Bokeh\.embed/i,
	/d3\.(?:select|json|csv|tsv|geoPath)/i,
	/three\.(?:min\.)?js|THREE\.WebGLRenderer/i,
	/vega(?:-embed|-lite)|vegaEmbed\(/i,
	/<iframe\b[^>]*srcdoc=/i,
	/window\.addEventListener|document\.addEventListener|onload\s*=/i,
]

const SMALL_FILE_THRESHOLD_BYTES = 64 * 1024 // 64 KB

export type DetectedMode = "safe" | "interactive"

export function detectMode(html: string): DetectedMode {
	if (!html) {
		return "safe"
	}
	if (html.length > SMALL_FILE_THRESHOLD_BYTES) {
		return "interactive"
	}
	for (const re of INTERACTIVE_FINGERPRINTS) {
		if (re.test(html)) {
			return "interactive"
		}
	}
	return "safe"
}
