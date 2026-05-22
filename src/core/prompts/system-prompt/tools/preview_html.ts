import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"

const id = AiHydroDefaultTool.PREVIEW_HTML

const generic: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "preview_html",
	description: `Request to render HTML in the AI-Hydro Preview panel. One preview experience handles static reports, Folium/Leaflet maps, Plotly dashboards, and other research artifacts — the extension picks the best render path and security profile automatically.
- Provide raw HTML and/or a file_path. If both are given, the on-disk file is preferred so relative assets resolve correctly.
- Optional mode override:
  * (default) omit mode — auto-detect (maps/charts run with scripts; plain HTML stays static-safe when appropriate).
  * "external_browser" — open in the user's default browser when the page needs full browser capabilities outside VS Code.
- Use this for formatted reports, tables, charts, and interactive visualizations that are better shown as HTML than plain text.
- For runnable cells use the official contract (see docs/html-preview-cells.md):
  <div class="aihydro-cell" data-aihydro-cell-id="cell-001" data-language="python" data-execution="kernel">
    <pre class="aihydro-source">code here</pre>
    <div class="aihydro-output"></div>
  </div>
  Optional: <script type="application/vnd.aihydro.cell+json">{"id":"cell-001","language":"python"}</script>
  Users run cells from the HTML Preview panel toolbar (Run Cell, Run All, Restart & Run All). Each artifact has its own kernel session.
- Python environment: user picks a kernel in the HTML Preview toolbar (VS Code interpreter, .venv, or .aihydro/venv). To add a hydro stack, create a venv with execute_command:
  python3 -m venv .aihydro/venv && .aihydro/venv/bin/pip install numpy pandas rasterio matplotlib
  Then click "↻ env" in the preview toolbar to refresh environments.`,
	contextRequirements: () => true,
	parameters: [
		{
			name: "html",
			required: false,
			instruction: `Raw HTML to preview. If both html and file_path are provided, file_path wins.
	* Example: <html><body><h1>Report</h1></body></html>`,
			usage: "Raw HTML string content",
		},
		{
			name: "file_path",
			required: false,
			instruction: `Path to an HTML file (absolute or workspace-relative).
	* Example: <file_path>./report.html</file_path>`,
			usage: "Path to HTML file",
		},
		{
			name: "title",
			required: false,
			instruction: `Optional title shown in the preview toolbar.
	* Example: <title>Q3 Sales Report</title>`,
			usage: "Preview title",
		},
		{
			name: "mode",
			required: false,
			instruction: `Optional override. Usually omit this and let Preview auto-detect.
	* "external_browser" — open in the system default browser instead of the panel.
	* Example: <mode>external_browser</mode>`,
			usage: "external_browser (optional)",
		},
	],
}

export const preview_html_variants = [generic]
