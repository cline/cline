import { expect } from "chai"
import fs from "fs"
import { describe, it } from "mocha"
import os from "os"
import path from "path"
import { formatValidationReport, validateModule } from "../validateModule"

const EXAMPLES_DIR = path.join(os.homedir(), "Documents/AI-Hydro/Skills/skills/interactive-module-builder/assets/examples")
const FILES = ["master-recession-curve.html", "flow-duration-curve.html", "terrain-to-wetness-twi.html"]

// The exemplar HTML lives in the sibling AI-Hydro/Skills working copy, which is
// not present in CI. Skip the suite when it is absent rather than fail.
const examplesPresent = fs.existsSync(EXAMPLES_DIR)

describe("exemplar modules", () => {
	before(function () {
		if (!examplesPresent) {
			this.skip()
		}
	})
	for (const file of FILES) {
		it(`${file} validates with zero errors`, () => {
			const html = fs.readFileSync(path.join(EXAMPLES_DIR, file), "utf8")
			const result = validateModule(html)
			expect(result.errorCount, formatValidationReport(result, file)).to.equal(0)
		})
	}
})
