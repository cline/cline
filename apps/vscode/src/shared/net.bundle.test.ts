import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build } from "esbuild"

let outputDirectory: string

async function buildNetBundle(mode: "vscode" | "standalone"): Promise<string> {
	const outfile = path.join(outputDirectory, `${mode}.cjs`)
	await build({
		entryPoints: [path.join(import.meta.dir, "net.ts")],
		outfile,
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "node22.15",
		define: {
			"process.env.IS_STANDALONE": JSON.stringify(mode === "standalone" ? "true" : "false"),
		},
	})
	return outfile
}

function inspectBundle(bundlePath: string): {
	before: Array<string | null>
	after: Array<string | null>
} {
	const node = Bun.which("node")
	if (!node) {
		throw new Error("Node is required to verify dispatcher isolation")
	}
	const script = `
		const keys = [1, 2].map((version) => Symbol.for("undici.globalDispatcher." + version));
		const snapshot = () => keys.map((key) => globalThis[key]?.constructor?.name ?? null);
		const before = snapshot();
		require(${JSON.stringify(bundlePath)});
		process.stdout.write(JSON.stringify({ before, after: snapshot() }));
	`
	const result = Bun.spawnSync([node, "-e", script], {
		stdout: "pipe",
		stderr: "pipe",
	})
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString())
	}
	return JSON.parse(result.stdout.toString())
}

beforeAll(async () => {
	outputDirectory = await mkdtemp(path.join(tmpdir(), "cline-net-bundle-"))
})

afterAll(async () => {
	await rm(outputDirectory, { recursive: true, force: true })
})

describe("network bundle dispatcher isolation", () => {
	it("does not install a userland dispatcher in the VS Code host", async () => {
		const result = inspectBundle(await buildNetBundle("vscode"))

		expect(result.after).toEqual(result.before)
	})

	it("installs the proxy-aware dispatcher in standalone builds", async () => {
		const result = inspectBundle(await buildNetBundle("standalone"))

		expect(result.after).not.toEqual(result.before)
		expect(result.after.every((name) => name?.startsWith("EnvHttpProxyAgent"))).toBe(true)
	})
})
