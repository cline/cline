import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

const RUNNER = path.resolve(__dirname, "..", "artifact_kernel_runner.py")

function runKernel(lines: string[]): Promise<Record<string, unknown>[]> {
	return new Promise((resolve, reject) => {
		const child = spawn("python3", [RUNNER], { stdio: ["pipe", "pipe", "pipe"] })
		const outputs: Record<string, unknown>[] = []
		let buffer = ""

		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString()
			const parts = buffer.split("\n")
			buffer = parts.pop() ?? ""
			for (const line of parts) {
				if (line.trim()) {
					outputs.push(JSON.parse(line) as Record<string, unknown>)
				}
			}
		})

		child.stderr.on("data", () => {})
		child.on("error", reject)
		child.on("close", (code) => {
			if (code !== 0 && outputs.length === 0) {
				reject(new Error(`kernel exited ${code}`))
				return
			}
			resolve(outputs)
		})

		for (const line of lines) {
			child.stdin.write(`${line}\n`)
		}
		child.stdin.end()
	})
}

describe("artifact_kernel_runner.py", function () {
	this.timeout(15_000)

	before(function () {
		if (!existsSync(RUNNER)) {
			this.skip()
		}
	})

	it("persists variables across exec calls", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "a", code: "x = 41" }),
			JSON.stringify({ op: "exec", id: "b", code: "x += 1\nprint(x)" }),
		])

		expect(responses[0]?.status).to.equal("ok")
		expect(responses[2]?.status).to.equal("ok")
		expect(String(responses[2]?.stdout)).to.include("42")
	})

	it("returns traceback on syntax errors", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "bad", code: "def (" }),
		])

		expect(responses[1]?.status).to.equal("error")
		expect(String(responses[1]?.error)).to.include("SyntaxError")
	})

	it("degrades gracefully on a video cell when manim is unavailable", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({
				op: "exec",
				id: "v",
				code: "# __aihydro_render_video__\nprint('built scene')",
			}),
		])

		const res = responses[1]
		// With manim installed this renders MP4s; without it we still succeed
		// (status ok) and surface a note rather than crashing the cell.
		expect(res?.status).to.equal("ok")
		const hasVideos = Array.isArray(res?.videos_mp4_base64) && (res?.videos_mp4_base64 as unknown[]).length > 0
		if (!hasVideos) {
			expect(String(res?.stderr)).to.include("Manim is not installed")
		}
	})

	it("clears namespace on restart", async () => {
		const responses = await runKernel([
			JSON.stringify({ op: "ping", id: "ping" }),
			JSON.stringify({ op: "exec", id: "a", code: "y = 99" }),
			JSON.stringify({ op: "restart", id: "r" }),
			JSON.stringify({ op: "exec", id: "b", code: "print(y)" }),
		])

		expect(responses[3]?.status).to.equal("error")
		expect(String(responses[3]?.error)).to.include("NameError")
	})
})
