import * as fs from "fs/promises"
import { after, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { listFiles } from "../list-files"

function normalizeForComparison(filePath: string): string {
	return filePath.replaceAll("\\", "/")
}

describe("listFiles", () => {
	const tmpDir = path.join(os.tmpdir(), `cline-list-files-test-${Math.random().toString(36).slice(2)}`)

	after(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
	})

	it("returns empty result when cwd points to a file", async () => {
		await fs.mkdir(tmpDir, { recursive: true })
		const filePath = path.join(tmpDir, "single-file.ts")
		await fs.writeFile(filePath, "export const x = 1\n")

		const [files, didHitLimit] = await listFiles(filePath, false, 200)

		files.should.deepEqual([])
		didHitLimit.should.equal(false)
	})

	it("still lists files when cwd points to a directory", async () => {
		await fs.mkdir(tmpDir, { recursive: true })
		const nestedFile = path.join(tmpDir, "index.ts")
		await fs.writeFile(nestedFile, "export const ok = true\n")

		const [files] = await listFiles(tmpDir, false, 200)

		files.map(normalizeForComparison).should.containEql(normalizeForComparison(nestedFile))
	})
})

describe("listFiles gitignore handling", () => {
	// Each test gets its own isolated subdirectory to avoid cross-test pollution.
	// Previous version shared a single tmpDir, which meant later tests could
	// overwrite earlier .gitignore files and pass for the wrong reasons.
	const baseDir = path.join(os.tmpdir(), `cline-gitignore-test-${Math.random().toString(36).slice(2)}`)

	after(async () => {
		await fs.rm(baseDir, { recursive: true, force: true }).catch(() => undefined)
	})

	it("excludes files matching root .gitignore directory patterns", async () => {
		// Verifies the most common .gitignore use case: a directory pattern like "some-dir/"
		// at the project root excludes that directory and everything inside it.
		//
		// project/
		//   .gitignore       → "ignored-dir/"
		//   visible.ts
		//   ignored-dir/
		//     secret.ts      ← should be excluded
		//   src/
		//     app.ts
		const project = path.join(baseDir, "test-root-gitignore")
		await fs.mkdir(path.join(project, "ignored-dir"), { recursive: true })
		await fs.mkdir(path.join(project, "src"), { recursive: true })
		await fs.writeFile(path.join(project, ".gitignore"), "ignored-dir/\n")
		await fs.writeFile(path.join(project, "visible.ts"), "export const x = 1\n")
		await fs.writeFile(path.join(project, "ignored-dir", "secret.ts"), "secret\n")
		await fs.writeFile(path.join(project, "src", "app.ts"), "app\n")

		const [files] = await listFiles(project, true, 200)
		const normalized = files.map(normalizeForComparison)

		normalized.should.containEql(normalizeForComparison(path.join(project, "visible.ts")))
		normalized.should.containEql(normalizeForComparison(path.join(project, "src", "app.ts")))

		const hasIgnoredContent = normalized.some((f) => f.includes("ignored-dir"))
		hasIgnoredContent.should.equal(false, "ignored-dir/ contents should be excluded by root .gitignore")
	})

	it("excludes files matching .gitignore file patterns (not just directories)", async () => {
		// The .gitignore parser handles two kinds of patterns differently:
		// - Directory patterns ending in "/" → converted to "**/dir/**"
		// - File/glob patterns like "*.log"  → converted to "**/*.log" + "**/*.log/**"
		// This test exercises the file pattern branch.
		//
		// project/
		//   .gitignore       → "*.log\nsecret.env"
		//   app.ts
		//   debug.log        ← should be excluded
		//   src/
		//     nested.log     ← should also be excluded (pattern is global)
		//     secret.env     ← should be excluded
		//     config.ts
		const project = path.join(baseDir, "test-file-patterns")
		await fs.mkdir(path.join(project, "src"), { recursive: true })
		await fs.writeFile(path.join(project, ".gitignore"), "*.log\nsecret.env\n")
		await fs.writeFile(path.join(project, "app.ts"), "app\n")
		await fs.writeFile(path.join(project, "debug.log"), "debug output\n")
		await fs.writeFile(path.join(project, "src", "nested.log"), "nested log\n")
		await fs.writeFile(path.join(project, "src", "secret.env"), "API_KEY=xxx\n")
		await fs.writeFile(path.join(project, "src", "config.ts"), "config\n")

		const [files] = await listFiles(project, true, 200)
		const normalized = files.map(normalizeForComparison)

		normalized.should.containEql(normalizeForComparison(path.join(project, "app.ts")))
		normalized.should.containEql(normalizeForComparison(path.join(project, "src", "config.ts")))

		const hasLogFiles = normalized.some((f) => f.endsWith(".log"))
		hasLogFiles.should.equal(false, "*.log files should be excluded")

		const hasSecretEnv = normalized.some((f) => f.includes("secret.env"))
		hasSecretEnv.should.equal(false, "secret.env should be excluded")
	})

	it("reads .gitignore from subdirectories during BFS traversal", async () => {
		// .gitignore files aren't only at the root — subdirectories can have their own.
		// During BFS, when we enter a non-ignored directory, we read its .gitignore
		// and add those patterns to the accumulator for all deeper traversal.
		//
		// project/
		//   src/
		//     .gitignore     → "generated/"
		//     code.ts
		//     generated/
		//       output.ts    ← should be excluded by src/.gitignore
		//   lib/
		//     util.ts
		const project = path.join(baseDir, "test-subdirectory-gitignore")
		const srcDir = path.join(project, "src")
		const genDir = path.join(srcDir, "generated")
		const libDir = path.join(project, "lib")
		await fs.mkdir(genDir, { recursive: true })
		await fs.mkdir(libDir, { recursive: true })
		await fs.writeFile(path.join(srcDir, ".gitignore"), "generated/\n")
		await fs.writeFile(path.join(srcDir, "code.ts"), "code\n")
		await fs.writeFile(path.join(genDir, "output.ts"), "generated output\n")
		await fs.writeFile(path.join(libDir, "util.ts"), "util\n")

		const [files] = await listFiles(project, true, 200)
		const normalized = files.map(normalizeForComparison)

		normalized.should.containEql(normalizeForComparison(path.join(srcDir, "code.ts")))
		normalized.should.containEql(normalizeForComparison(path.join(libDir, "util.ts")))

		const hasGeneratedContent = normalized.some((f) => f.includes("generated"))
		hasGeneratedContent.should.equal(false, "src/generated/ should be excluded by src/.gitignore")
	})

	it("does not read .gitignore from inside gitignored directories", async () => {
		// This is the core OOM-prevention test.
		//
		// The crash scenario: a gitignored directory (e.g., third-party/) contains
		// hundreds of nested repos, each with their own .gitignore. globby's old
		// gitignore:true would read ALL of them upfront, build a massive regex,
		// and OOM during V8 regex compilation.
		//
		// With incremental reading, we never enter third-party/ because the root
		// .gitignore excludes it, so we never read any .gitignore files inside it.
		//
		// NOTE: We intentionally use "third-party/" instead of "vendor/" here because
		// "vendor" is in DEFAULT_IGNORE_DIRECTORIES and would be excluded regardless
		// of .gitignore. Using a name NOT in that list proves the .gitignore-based
		// exclusion is actually working.
		//
		// project/
		//   .gitignore          → "third-party/"
		//   app.ts
		//   third-party/
		//     .gitignore        ← should never be read
		//     repo1/
		//       .gitignore      ← should never be read
		//       file.ts
		const project = path.join(baseDir, "test-no-read-inside-ignored")
		const thirdPartyDir = path.join(project, "third-party")
		const repo1Dir = path.join(thirdPartyDir, "repo1")
		await fs.mkdir(repo1Dir, { recursive: true })
		await fs.writeFile(path.join(project, ".gitignore"), "third-party/\n")
		await fs.writeFile(path.join(project, "app.ts"), "app\n")
		// These .gitignore files simulate the nested repos that caused OOM
		await fs.writeFile(path.join(thirdPartyDir, ".gitignore"), "*.log\nbuild/\n")
		await fs.writeFile(path.join(repo1Dir, ".gitignore"), "dist/\ncoverage/\n")
		await fs.writeFile(path.join(repo1Dir, "file.ts"), "file\n")

		const [files] = await listFiles(project, true, 200)
		const normalized = files.map(normalizeForComparison)

		normalized.should.containEql(normalizeForComparison(path.join(project, "app.ts")))

		const hasThirdPartyContent = normalized.some((f) => f.includes("third-party"))
		hasThirdPartyContent.should.equal(false, "third-party/ contents should be excluded — and its .gitignore files never read")
	})
})
