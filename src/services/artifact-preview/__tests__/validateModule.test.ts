import { expect } from "chai"
import { describe, it } from "mocha"
import { formatValidationReport, validateModule } from "../validateModule"

const VALID_MODULE = `<!doctype html><html><head>
<script type="application/vnd.aihydro.module+json">
{"id":"demo","title":"Demo","version":"0.1.0","authors":[{"name":"AI-Hydro Agent"}],"license":"CC-BY-4.0","topic":"hydrology"}
</script>
</head><body>
<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python">
  <button class="aihydro-run" type="button">Run</button>
  <pre class="aihydro-source">import numpy as np
print(np.sqrt(2))</pre>
  <div class="aihydro-output"></div>
</div>
<div class="aihydro-quiz"><div class="aihydro-quiz-question" data-answer="0"></div></div>
<footer class="aihydro-provenance"></footer>
<section><h2>References</h2></section>
<a href="https://creativecommons.org/licenses/by/4.0/">CC-BY-4.0</a>
</body></html>`

describe("validateModule", () => {
	it("passes a well-formed module with no errors", () => {
		const result = validateModule(VALID_MODULE)
		expect(result.ok, JSON.stringify(result.findings)).to.equal(true)
		expect(result.errorCount).to.equal(0)
		expect(result.cellCount).to.equal(1)
	})

	it("counts a cell with an aihydro-cell-header as a single cell", () => {
		const html = VALID_MODULE.replace(
			'<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python">\n  <button class="aihydro-run" type="button">Run</button>',
			'<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python">\n  <div class="aihydro-cell-header"><span class="aihydro-cell-lang">python</span><button class="aihydro-run" type="button">Run</button></div>',
		)
		const result = validateModule(html)
		expect(result.cellCount, formatValidationReport(result)).to.equal(1)
		expect(result.findings.some((f) => f.code === "CELL_NO_ID")).to.equal(false)
		expect(result.findings.some((f) => f.code === "CELL_NO_LANG")).to.equal(false)
	})

	it("flags a missing manifest", () => {
		const result = validateModule(
			`<html><body><div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python"></div></body></html>`,
		)
		expect(result.ok).to.equal(false)
		expect(result.findings.some((f) => f.code === "MANIFEST_MISSING")).to.equal(true)
	})

	it("flags a cell missing its id and language", () => {
		const html = VALID_MODULE.replace('data-aihydro-cell-id="c1" data-language="python"', "")
		const result = validateModule(html)
		expect(result.findings.some((f) => f.code === "CELL_NO_ID")).to.equal(true)
		expect(result.findings.some((f) => f.code === "CELL_NO_LANG")).to.equal(true)
	})

	it("flags duplicate cell ids", () => {
		const html = VALID_MODULE.replace(
			'<div class="aihydro-output"></div>\n</div>',
			'<div class="aihydro-output"></div>\n</div>\n<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python"><pre class="aihydro-source">x=1</pre></div>',
		)
		const result = validateModule(html)
		expect(result.findings.some((f) => f.code === "CELL_DUP_ID")).to.equal(true)
	})

	it("flags plt.show(), matplotlib.use(), CSS rgba() and file I/O in Python cells", () => {
		const html = VALID_MODULE.replace(
			"import numpy as np\nprint(np.sqrt(2))",
			"import matplotlib\nmatplotlib.use('Agg')\nopen('x.txt')\nax.set_color('rgba(0,0,0,1)')\nplt.show()",
		)
		const result = validateModule(html)
		const codes = result.findings.map((f) => f.code)
		expect(codes).to.include.members(["PY_PLT_SHOW", "PY_MPL_USE", "PY_CSS_RGBA", "PY_FILE_IO"])
	})

	it("flags a <code> wrapper and an onclick Run button", () => {
		const html = VALID_MODULE.replace(
			'<button class="aihydro-run" type="button">Run</button>\n  <pre class="aihydro-source">import numpy as np\nprint(np.sqrt(2))</pre>',
			'<button class="aihydro-run" onclick="run()">Run</button>\n  <pre class="aihydro-source"><code>import numpy as np</code></pre>',
		)
		const result = validateModule(html)
		const codes = result.findings.map((f) => f.code)
		expect(codes).to.include.members(["CELL_CODE_WRAPPER", "CELL_ONCLICK"])
	})

	it("flags a video-render cell with no Manim Scene subclass", () => {
		const html = VALID_MODULE.replace(
			'<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python">',
			'<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python" data-aihydro-render="video">',
		)
		const result = validateModule(html)
		expect(result.findings.some((f) => f.code === "VIDEO_NO_SCENE")).to.equal(true)
	})

	it("accepts a video-render cell that defines a Scene subclass", () => {
		const html = VALID_MODULE.replace(
			'<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="python">\n  <button class="aihydro-run" type="button">Run</button>\n  <pre class="aihydro-source">import numpy as np\nprint(np.sqrt(2))</pre>',
			'<div class="aihydro-cell" data-aihydro-cell-id="c1" data-language="manim">\n  <button class="aihydro-run" type="button">Run</button>\n  <pre class="aihydro-source">from manim import *\nclass S(Scene):\n    def construct(self):\n        self.wait(1)</pre>',
		)
		const result = validateModule(html)
		expect(result.findings.some((f) => f.code === "VIDEO_NO_SCENE")).to.equal(false)
		// manim cells skip the python-source rules
		expect(result.findings.some((f) => f.code === "PY_PLT_SHOW")).to.equal(false)
	})

	it("flags a hardcoded three.js tag and an ESM-only examples/jsm path", () => {
		const html = VALID_MODULE.replace(
			"</body>",
			'<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>' +
				'<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js"></script></body>',
		)
		const result = validateModule(html)
		const codes = result.findings.map((f) => f.code)
		expect(codes).to.include.members(["THREE_HARDCODED", "CDN_JSM_PATH"])
	})

	it("flags a floating @latest CDN version", () => {
		const html = VALID_MODULE.replace("</body>", '<script src="https://cdn.plot.ly/plotly@latest.min.js"></script></body>')
		const result = validateModule(html)
		expect(result.findings.some((f) => f.code === "CDN_FLOATING")).to.equal(true)
	})

	it("warns on a sim/scene3d canvas with no matching aihydro call", () => {
		const html = VALID_MODULE.replace(
			"</body>",
			"<canvas data-aihydro-sim></canvas><canvas data-aihydro-scene3d></canvas></body>",
		)
		const result = validateModule(html)
		const codes = result.findings.map((f) => f.code)
		expect(codes).to.include.members(["SIM_NO_CALL", "SCENE3D_NO_CALL"])
	})

	it("does not warn when the sim/scene3d canvas has a matching call", () => {
		const html = VALID_MODULE.replace(
			"</body>",
			"<canvas data-aihydro-sim></canvas><canvas data-aihydro-scene3d></canvas>" +
				'<script>aihydro.sim({canvas:"#x"});aihydro.scene3d({canvas:"#y"});</script></body>',
		)
		const result = validateModule(html)
		const codes = result.findings.map((f) => f.code)
		expect(codes).to.not.include("SIM_NO_CALL")
		expect(codes).to.not.include("SCENE3D_NO_CALL")
	})
})
