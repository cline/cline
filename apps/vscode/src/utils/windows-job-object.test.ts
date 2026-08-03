import { describe, expect, it } from "vitest"
import { spawnWithWindowsJob, withWindowsJob } from "./windows-job-object"

describe("withWindowsJob", () => {
	it("appends windowsJob when forced", () => {
		const options = { cwd: "/tmp" }
		expect(withWindowsJob(options, true)).toEqual({ cwd: "/tmp", windowsJob: true })
	})

	it("never mutates the input object", () => {
		const options = { cwd: "/tmp" }
		withWindowsJob(options, true)
		expect(options).toEqual({ cwd: "/tmp" })
	})

	it("returns the input unchanged on unsupported platforms when not forced", () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
		Object.defineProperty(process, "platform", { value: "linux" })
		try {
			const options = { cwd: "/tmp" }
			// Same reference — no new object allocated on POSIX.
			expect(withWindowsJob(options)).toBe(options)
		} finally {
			Object.defineProperty(process, "platform", originalPlatform!)
		}
	})

	it("preserves all original spawn options alongside windowsJob", () => {
		const options = { cwd: "/tmp", env: { A: "1" }, detached: true, stdio: "ignore" as const }
		expect(withWindowsJob(options, true)).toEqual({ ...options, windowsJob: true })
	})
})

describe("spawnWithWindowsJob", () => {
	it("spawns a child process that runs to completion", async () => {
		const child = spawnWithWindowsJob(process.execPath, ["-e", "process.exit(0)"])
		const code = await new Promise<number | null>((resolve) => child.on("close", resolve))
		expect(code).toBe(0)
	})

	it("propagates child stdout", async () => {
		const child = spawnWithWindowsJob(process.execPath, ["-e", "process.stdout.write('ok')"])
		let output = ""
		child.stdout?.on("data", (chunk) => {
			output += chunk.toString()
		})
		const code = await new Promise<number | null>((resolve) => child.on("close", resolve))
		expect(code).toBe(0)
		expect(output).toBe("ok")
	})
})
