import fs from "node:fs"
import path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import { formatValidationReport, validateModule } from "../validateModule"

const FIXTURE_ROOT = path.join(process.cwd(), "src", "test", "fixtures", "html-preview", "golden-course")

function readFixture(relativePath: string): string {
	return fs.readFileSync(path.join(FIXTURE_ROOT, relativePath), "utf8")
}

function extractCellIds(html: string): string[] {
	return Array.from(html.matchAll(/data-aihydro-cell-id=["']([^"']+)["']/g), (match) => match[1])
}

describe("HTML Preview golden course fixture", () => {
	it("contains a valid two-module course manifest with a prerequisite edge", () => {
		const course = JSON.parse(readFixture("course.json")) as {
			courseId: string
			kernel: string
			modules: Array<{ id: string; path: string; prerequisites?: string[] }>
		}

		expect(course.courseId).to.equal("aihydro-runtime-contract-fixture")
		expect(course.kernel).to.equal("isolated")
		expect(course.modules.map((module) => module.id)).to.deep.equal(["runtime-contract-01", "runtime-contract-02"])
		expect(course.modules[1].prerequisites).to.deep.equal(["runtime-contract-01"])

		for (const module of course.modules) {
			expect(fs.existsSync(path.join(FIXTURE_ROOT, module.path)), module.path).to.equal(true)
		}
	})

	it("passes the current static module validator", () => {
		for (const relativePath of ["01-runtime-contract/module.html", "02-prerequisite-target/module.html"]) {
			const result = validateModule(readFixture(relativePath))
			expect(result.ok, `${relativePath}\n${formatValidationReport(result)}`).to.equal(true)
			expect(result.errorCount, relativePath).to.equal(0)
		}
	})

	it("uses stable unique cell IDs and the current source/output contract", () => {
		const html = readFixture("01-runtime-contract/module.html")
		const cellIds = extractCellIds(html)

		expect(cellIds).to.deep.equal(["fixture-state-create", "fixture-state-read-plot", "fixture-error"])
		expect(new Set(cellIds).size).to.equal(cellIds.length)
		expect(html).to.include('<pre class="aihydro-source">')
		expect(html).to.include('class="aihydro-output" aria-live="polite"')
		expect(html).to.not.match(/<pre[^>]*class=["'][^"']*aihydro-source[^"']*["'][^>]*>\s*<code\b/i)
		expect(html).to.not.match(/<button\b[^>]*\bonclick=/i)
	})

	it("covers control-state binding, namespace reuse, image output, error output, and a canonical self-check", () => {
		const html = readFixture("01-runtime-contract/module.html")

		expect(html).to.include("{{storage}}")
		expect(html).to.include("window.aihydro.bindParam")
		expect(html).to.include('cellId: "fixture-state-create"')
		expect(html).to.include("storage_next")
		expect(html).to.include("matplotlib.pyplot")
		expect(html).to.include('raise ValueError("intentional runtime-contract fixture error")')
		expect(html).to.include('class="aihydro-quiz"')
		expect(html).to.include('data-answer="1"')
		expect(html).to.include('id="runtime-contract-quiz"')
	})
})
