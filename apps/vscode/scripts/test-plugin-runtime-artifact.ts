import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import extract from "extract-zip"

type RpcResponse = {
	type: "response"
	id: string
	ok: boolean
	result?: unknown
	error?: { message?: string; stack?: string }
}

async function main() {
	const vsixPath = path.resolve(process.argv[2] ?? "")
	if (!existsSync(vsixPath)) throw new Error(`VSIX not found: ${vsixPath}`)

	const tempRoot = await mkdtemp(path.join(tmpdir(), "cline-plugin-runtime-"))
	try {
		await extract(vsixPath, { dir: tempRoot })
		const extensionRoot = path.join(tempRoot, "extension")
		const runtimeRoot = path.join(extensionRoot, "dist", "plugin-runtime")
		const aliases = JSON.parse(await readFile(path.join(runtimeRoot, "aliases.json"), "utf8")) as Record<string, string>
		const realRuntimeRoot = await realpath(runtimeRoot)
		for (const [specifier, target] of Object.entries(aliases)) {
			const realTarget = await realpath(path.join(runtimeRoot, target))
			if (realTarget !== realRuntimeRoot && !realTarget.startsWith(`${realRuntimeRoot}${path.sep}`)) {
				throw new Error(`Plugin runtime alias escapes the VSIX: ${specifier} -> ${target}`)
			}
		}

		const pluginPath = path.join(tempRoot, "plugin.ts")
		await writeFile(
			pluginPath,
			[
				"import { createTool } from '@cline/sdk'",
				"export default {",
				"  name: 'artifact-plugin',",
				"  manifest: { capabilities: ['tools', 'commands'] },",
				"  setup(api) {",
				"    api.registerTool(createTool({",
				"      name: 'artifact_tool', description: 'artifact tool', inputSchema: { type: 'object' },",
				"      execute: async () => ({ ok: true }),",
				"    }))",
				"    api.registerCommand({ name: 'artifact', description: 'Artifact command', handler: (input) => ({ reply: `ok:${input}` }) })",
				"  },",
				"}",
			].join("\n"),
			"utf8",
		)

		const bootstrap = path.join(runtimeRoot, "core", "src", "extensions", "plugin", "plugin-sandbox-bootstrap.js")
		const nodeExecutable = process.env.CLINE_JS_RUNTIME_PATH?.trim() || "node"
		const child = spawn(nodeExecutable, [bootstrap], {
			cwd: tempRoot,
			stdio: ["ignore", "ignore", "pipe", "ipc"],
			env: {
				HOME: tempRoot,
				PATH: process.env.PATH,
				CLINE_PLUGIN_RUNTIME_DIR: runtimeRoot,
				CLINE_PLUGIN_RUNTIME_EXPECT_NODE: "1",
			},
		})
		let stderr = ""
		child.stderr.setEncoding("utf8")
		child.stderr.on("data", (chunk: string) => {
			stderr = `${stderr}${chunk}`.slice(-4000)
		})
		try {
			const initialized = (await call(
				child,
				"initialize",
				{
					pluginPaths: [pluginPath],
					cwd: tempRoot,
				},
				4_000,
			)) as {
				plugins: Array<{
					pluginId: string
					contributions: { commands: Array<{ id: string; name: string }> }
				}>
				failures?: unknown[]
				warnings?: unknown[]
			}
			const plugin = initialized.plugins.find((entry) =>
				entry.contributions.commands.some((command) => command.name === "artifact"),
			)
			const command = plugin?.contributions.commands.find((entry) => entry.name === "artifact")
			if (!plugin || !command) {
				throw new Error(`Shipped runtime did not load the artifact command: ${JSON.stringify(initialized)}`)
			}
			const result = await call(child, "executeCommand", {
				pluginId: plugin.pluginId,
				contributionId: command.id,
				input: "hello",
			})
			if (JSON.stringify(result) !== JSON.stringify({ reply: "ok:hello" })) {
				throw new Error(`Unexpected artifact command result: ${JSON.stringify(result)}`)
			}
		} finally {
			if (child.exitCode === null) {
				child.kill("SIGTERM")
				await new Promise<void>((resolve) => child.once("exit", () => resolve()))
			}
		}
		if (stderr.trim()) throw new Error(`Plugin runtime wrote to stderr:\n${stderr}`)
		console.log(`Plugin runtime artifact verified: ${vsixPath}`)
	} finally {
		await rm(tempRoot, { recursive: true, force: true })
	}
}

async function call(child: ReturnType<typeof spawn>, method: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
	const id = `${method}-${Date.now()}-${Math.random()}`
	return await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.off("message", onMessage)
			reject(new Error(`Plugin runtime call timed out after ${timeoutMs}ms: ${method}`))
		}, timeoutMs)
		const onMessage = (message: RpcResponse) => {
			if (message?.type !== "response" || message.id !== id) return
			clearTimeout(timeout)
			child.off("message", onMessage)
			if (message.ok) resolve(message.result)
			else reject(new Error(message.error?.stack ?? message.error?.message ?? `Plugin runtime call failed: ${method}`))
		}
		child.on("message", onMessage)
		child.send({ type: "call", id, method, args }, (error) => {
			if (!error) return
			clearTimeout(timeout)
			child.off("message", onMessage)
			reject(error)
		})
	})
}

await main()
