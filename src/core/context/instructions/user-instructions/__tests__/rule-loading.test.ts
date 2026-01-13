import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { getRuleFilesTotalContentWithMetadata } from "../rule-helpers"

describe("rule loading with paths frontmatter", () => {
	it("filters rules by evaluationContext.paths", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "universal.md"), "Always on")
			await fs.writeFile(path.join(rulesDir, "scoped.md"), `---\npaths:\n  - "src/**"\n---\n\nOnly for src`)

			const files = ["universal.md", "scoped.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "universal.md")]: true,
				[path.join(rulesDir, "scoped.md")]: true,
			}

			const res1 = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})
			expect(res1.content).to.contain("universal.md")
			expect(res1.content).to.contain("scoped.md")
			expect(res1.content).to.not.contain("paths:")
			expect(res1.activatedConditionalRules.map((r) => r.name)).to.include("scoped.md")

			const res2 = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["docs/readme.md"] },
			})
			expect(res2.content).to.contain("universal.md")
			expect(res2.content).to.not.contain("scoped.md")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})
