import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { assertTraceArtifact } from "../../scripts/check-trace-artifact.mjs"

const root = path.resolve(import.meta.dir, "../../../..")
const read = (file: string) => readFileSync(path.join(root, file), "utf8")
const checker = path.join(root, "apps/vscode/scripts/check-trace-artifact.mjs")
const valid = 'console.log({tracesExporter:"otlp"}, "cline-provider-langfuse")'
const flags = ["OTEL_TRACES_EXPORTER", "CLINE_TRACE_RECORD_CONTENT"]

describe("static trace artifact smoke", () => {
	it.each([
		valid,
		"f({'tracesExporter': 'otlp'}, 'cline-provider-langfuse')",
		`\0\ufffd${valid}\0`,
	])("accepts readable or minified JS and binary-embedded JS: %s", (bundle) =>
		expect(() => assertTraceArtifact(bundle)).not.toThrow())
	it.each([
		"",
		'console.log("otlp", "cline-provider-langfuse")',
		'console.log({logsExporter:"otlp",metricsExporter:"otlp"},"cline-provider-langfuse")',
		'console.log({tracesExporter:"console"},"cline-provider-langfuse")',
		'console.log({tracesExporter:"otlp"})',
	])("rejects missing trace-specific evidence: %s", (bundle) => {
		expect(() => assertTraceArtifact(bundle)).toThrow()
	})
	it.each(flags)("rejects unresolved %s even with positive evidence", (flag) => {
		for (const access of [`process.env.${flag}`, `process.env["${flag}"]`, `process?.env?.${flag}`]) {
			expect(() => assertTraceArtifact(`${valid};console.log(${access})`)).toThrow("Unresolved activation env name")
		}
	})
	it("allows the distinct runtime override alongside inlined build config", () => {
		expect(() => assertTraceArtifact(`${valid};console.log(process.env.CLINE_OTEL_TRACES_EXPORTER)`)).not.toThrow()
	})
	it("allows resolved config keys found in actual extension bundles", () => {
		expect(() =>
			assertTraceArtifact(`${valid};const config={OTEL_TRACES_EXPORTER:"otlp"};console.log(config.OTEL_TRACES_EXPORTER)`),
		).not.toThrow()
	})
	it("fails closed for missing files/arguments and checks stdin without executing artifacts", () => {
		for (const args of [[], [path.join(root, "nonexistent-trace-artifact")]]) {
			expect(spawnSync("node", [checker, ...args]).status).not.toBe(0)
		}
		expect(spawnSync("node", [checker, "-"], { input: valid }).status).toBe(0)
		expect(spawnSync("node", [checker, "-"], { input: "" }).status).not.toBe(0)
	})
	it("preserves the real SDK trace config through two minified passes", async () => {
		const dir = mkdtempSync(path.join(import.meta.dir, ".trace-build-"))
		try {
			const source = path.join(dir, "source.js")
			writeFileSync(
				source,
				// Real config implementation; scope/content are fixture stand-ins for
				// the prerequisite client PR, not evidence that it exists on this branch.
				`import { createClineTelemetryServiceConfig } from ${JSON.stringify(path.join(root, "sdk/packages/shared/src/services/telemetry-config.ts"))};
console.log(createClineTelemetryServiceConfig(),process.env.CLINE_TRACE_RECORD_CONTENT==="true","cline-provider-langfuse")`,
			)
			const sdk = await Bun.build({ entrypoints: [source], target: "node", minify: true })
			expect(sdk.success).toBe(true)
			const intermediate = await sdk.outputs[0].text()
			expect(() => assertTraceArtifact(intermediate)).toThrow("Unresolved activation env name")
			writeFileSync(source, intermediate)
			const app = await Bun.build({
				entrypoints: [source],
				target: "node",
				minify: true,
				define: { "process.env.OTEL_TRACES_EXPORTER": '"otlp"', "process.env.CLINE_TRACE_RECORD_CONTENT": '"true"' },
			})
			expect(app.success).toBe(true)
			assertTraceArtifact(await app.outputs[0].text())
			const binary = path.join(dir, "cline-smoke")
			const compiled = await Bun.build({
				entrypoints: [source],
				target: "bun",
				minify: true,
				compile: { outfile: binary },
				define: { "process.env.OTEL_TRACES_EXPORTER": '"otlp"', "process.env.CLINE_TRACE_RECORD_CONTENT": '"true"' },
			})
			expect(compiled.success).toBe(true)
			// Scan only; never execute the native artifact.
			assertTraceArtifact(readFileSync(binary, "utf8"))
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

// Parsed workflow structure, not a string match that can be satisfied by flags
// on an unrelated publish/SDK/legacy step. No workflow commands are executed.
type WorkflowStep = {
	name: string
	run: string
	env: Record<string, string>
	"working-directory": string
	if?: string
}
function workflow(name: string) {
	return Bun.YAML.parse(read(`.github/workflows/${name}.yml`)) as { jobs: Record<string, { steps: WorkflowStep[] }> }
}
function activationEnv(step: WorkflowStep) {
	expect(step.env.OTEL_TRACES_EXPORTER).toBe("otlp")
	expect(step.env.CLINE_TRACE_RECORD_CONTENT).toBe("true")
	expect(step.env.CLINE_TRACE_SAMPLE_PERCENT).toBeUndefined()
}

describe("activation compilation and artifact paths", () => {
	it.each(["ext-vscode-ab-package", "ext-vscode-publish-nightly"])("covers the combined next bundle: %s", (name) => {
		const jobs = workflow(name).jobs
		const steps = (jobs.build ?? jobs.publish).steps
		const build = steps.find((step: WorkflowStep) => step.name === "Build next bundle")!
		activationEnv(build)
		expect(build.env.CLINE_ROLLOUT_VARIANT).toBe("next")
		expect(build["working-directory"]).toBe("next-src/apps/vscode")
		expect(build.run).toContain("bun run package\n")
		expect(build.run).toContain("node scripts/check-trace-artifact.mjs dist/extension.js")
		for (const step of steps.filter((step: WorkflowStep) =>
			/Build SDK packages|Build legacy bundle|Build loader/.test(step.name),
		)) {
			for (const flag of flags) expect(step.env?.[flag]).toBeUndefined()
		}
		const check = steps.findIndex((step: WorkflowStep) => step.name === "Check packaged next trace activation")
		expect(check).toBeGreaterThan(steps.findIndex((step: WorkflowStep) => step.name === "Package VSIX"))
		expect(check).toBeLessThan(steps.findIndex((step: WorkflowStep) => step.name === "Upload VSIX artifact"))
		expect(steps[check]["working-directory"]).toBe("staging")
		expect(steps[check].run).toContain("set -euo pipefail")
		expect(steps[check].run).toContain("extension/next/dist/extension.js | node")
		expect(steps[check].run).toContain("$GITHUB_WORKSPACE/next-src/apps/vscode/scripts/check-trace-artifact.mjs")
	})
	it("retains the standalone stable compilation flags and checks its VSIX", () => {
		const step = workflow("ext-vscode-publish-stable").jobs.publish.steps.find(
			(s: WorkflowStep) => s.name === "Package and Publish Extension",
		)!
		activationEnv(step)
		expect(step.run).toContain("extension/dist/extension.js | node scripts/check-trace-artifact.mjs -")
		expect(step.run.indexOf("check-trace-artifact.mjs")).toBeLessThan(step.run.indexOf("bun run publish:marketplace"))
	})
	it.each(["publish-main", "publish-nightly"])("checks each CLI platform artifact before publish: %s", (job) => {
		const steps = workflow("cli-publish").jobs[job].steps
		const build = steps.find((step: WorkflowStep) => step.name === "Build platform binaries")!
		activationEnv(build)
		expect(build["working-directory"]).toBe("apps/cli")
		expect(build.run).toContain("bun script/build.ts")
		const check = steps.findIndex((step: WorkflowStep) => step.name === "Verify build output")
		expect(steps[check].run).toContain('node apps/vscode/scripts/check-trace-artifact.mjs "$dir"/bin/cline*')
		expect(check).toBeGreaterThan(steps.indexOf(build))
		expect(check).toBeLessThan(steps.findIndex((step: WorkflowStep) => step.name.startsWith("Publish to NPM")))
		if (job === "publish-nightly") expect(steps[check].if).toBe(build.if)
		const sdk = steps.find((step: WorkflowStep) => step.name === "Build SDK packages")!
		for (const flag of flags) expect(sdk.env?.[flag]).toBeUndefined()
	})
	it("defines both flags in the additional CLI JS bundle path", () => {
		for (const flag of flags) {
			expect(read("apps/cli/bun.mts")).toContain(`"process.env.${flag}": defineProcessEnv(`)
		}
		expect(read("sdk/packages/shared/bun.mts")).not.toContain("define:")
	})
})
