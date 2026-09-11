import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

function runPublisher(bundle: string | undefined, contentFlag = "true", dryRun = false) {
	const root = mkdtempSync(path.resolve(import.meta.dir, ".nightly-gate-"))
	try {
		mkdirSync(path.join(root, "scripts"))
		mkdirSync(path.join(root, "node_modules"))
		for (const script of ["publish-nightly.mjs", "marketplace-readme.mjs", "check-trace-artifact.mjs"]) {
			copyFileSync(path.resolve(import.meta.dir, "../../scripts", script), path.join(root, "scripts", script))
		}
		const original = JSON.stringify({
			name: "claude-dev",
			version: "1.0.0",
			contributes: { viewsContainers: { activitybar: { title: "Cline" } } },
		})
		writeFileSync(path.join(root, "package.json"), original)
		writeFileSync(path.join(root, "README.md"), "original")
		writeFileSync(path.join(root, "README.marketplace.md"), "marketplace")
		const preload = path.join(root, "mock-commands.mjs")
		// Replace the Node builtins before importing the real publish script.
		// No command, credential, network request, or actual package build escapes.
		writeFileSync(
			preload,
			`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
childProcess.execSync = () => Buffer.from("mock dependency available");
childProcess.execFileSync = (command, args, { cwd }) => {
  if (command === "vsce" && args[0] === "package") {
    appendFileSync(path.join(cwd, "calls"), "package\\n");
    const bundle = ${JSON.stringify(bundle) ?? "undefined"};
    if (bundle !== undefined) writeFileSync(path.join(cwd, "dist/extension.js"), bundle);
    return Buffer.alloc(0);
  }
  if ((command === "vsce" && args[0] === "publish") || (command === "npx" && args[0] === "ovsx" && args[1] === "publish")) {
    appendFileSync(path.join(cwd, "calls"), command === "vsce" ? "vscode\\n" : "openvsx\\n");
    return Buffer.alloc(0);
  }
  throw new Error("Unexpected subprocess: " + command);
};
syncBuiltinESMExports();
`,
		)
		const result = spawnSync(
			"node",
			[
				"--import",
				pathToFileURL(preload).href,
				path.join(root, "scripts/publish-nightly.mjs"),
				...(dryRun ? ["--dry-run"] : []),
			],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 10000,
				env: {
					PATH: process.env.PATH,
					SystemRoot: process.env.SystemRoot,
					VSCE_PAT: "mock",
					OVSX_PAT: "mock",
					CLINE_TRACE_RECORD_CONTENT: contentFlag,
				},
			},
		)
		expect(result.error).toBeUndefined()
		expect(result.signal).toBeNull()
		expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(original)
		expect(readFileSync(path.join(root, "README.md"), "utf8")).toBe("original")
		expect(existsSync(path.join(root, "node_modules/cline-nightly"))).toBe(false)
		return {
			status: result.status,
			output: result.stdout + result.stderr,
			calls: readFileSync(path.join(root, "calls"), "utf8").trim().split("\n"),
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

describe("nightly content-inlining publication gate", () => {
	it("blocks both marketplaces when the content flag survives packaging", () => {
		const result = runPublisher("console.log(process.env.CLINE_TRACE_RECORD_CONTENT)")
		expect(result.status).toBe(1)
		expect(result.output).toContain("Unresolved activation env name")
		expect(result.calls).toEqual(["package"])
	})

	it("fails closed when packaging did not produce the bundle", () => {
		const result = runPublisher(undefined)
		expect(result.status).toBe(1)
		expect(result.output).toContain("ENOENT")
		expect(result.calls).toEqual(["package"])
	})

	it("publishes to both marketplaces when the check passes", () => {
		const result = runPublisher('console.log({tracesExporter:"otlp"}, "cline-provider-langfuse")')
		expect(result.status).toBe(0)
		expect(result.calls).toEqual(["package", "vscode", "openvsx"])
	})

	it("keeps unconfigured local builds compatible with runtime reads", () => {
		const result = runPublisher("console.log(process.env.CLINE_TRACE_RECORD_CONTENT)", "")
		expect(result.status).toBe(0)
		expect(result.calls).toEqual(["package", "vscode", "openvsx"])
	})

	it("blocks a bundle that has no surviving env reads but also no trace implementation", () => {
		const result = runPublisher('console.log({logsExporter:"otlp"})')
		expect(result.status).toBe(1)
		expect(result.output).toContain("Missing trace-specific build config")
		expect(result.calls).toEqual(["package"])
	})

	it("runs the gate during dry runs too", () => {
		const result = runPublisher("console.log(process.env.CLINE_TRACE_RECORD_CONTENT)", "true", true)
		expect(result.status).toBe(1)
		expect(result.calls).toEqual(["package"])
	})
})
