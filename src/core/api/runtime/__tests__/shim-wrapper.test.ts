import { expect } from "chai"
import { Readable } from "node:stream"
import { describe, it } from "mocha"
import { RuntimeShimWrapper } from "../shim-wrapper"
import type { RuntimeStreamTranslator } from "../stream-translator"
import { collectAsyncChunks } from "../test-kit"

const createTranslator = (): RuntimeStreamTranslator<string> => ({
	translateStdout: (line) => [line.toUpperCase()],
	flush: () => [],
})

const createFakeChild = (options?: { stdout?: string[]; stderr?: string[]; exitCode?: number | null }) => {
	const stdout = Readable.from((options?.stdout ?? []).map((line) => `${line}\n`))
	const stderr = Readable.from(options?.stderr ?? [])
	const listeners: Record<string, Array<(value: any) => void>> = { close: [], error: [] }
	let killed = false

	const child = {
		stdin: {
			write: (_chunk: string) => undefined,
			end: () => undefined,
		},
		stdout,
		stderr,
		killed,
		kill: () => {
			killed = true
			child.killed = true
		},
		on(event: "close" | "error", listener: (value: any) => void) {
			listeners[event].push(listener)
			if (event === "close") {
				queueMicrotask(() => listener(options?.exitCode ?? 0))
			}
			return child
		},
		then(onfulfilled: (value: { exitCode: number | null }) => void) {
			return Promise.resolve({ exitCode: options?.exitCode ?? 0 }).then(onfulfilled)
		},
	}

	return child
}

describe("RuntimeShimWrapper", () => {
	it("streams translated stdout lines from a launched process", async () => {
		const wrapper = new RuntimeShimWrapper(() => createFakeChild({ stdout: ["alpha", "beta"] }) as any)
		const chunks = await collectAsyncChunks(
			wrapper.execute({ command: "fake-cli", args: ["--json"], cwd: "/tmp", stdinPayload: "[]" }, createTranslator()),
		)

		expect(chunks).to.deep.equal(["ALPHA", "BETA"])
	})

	it("normalizes non-zero exit failures with stderr context", async () => {
		const wrapper = new RuntimeShimWrapper(() => createFakeChild({ stdout: ["alpha"], stderr: ["boom"], exitCode: 2 }) as any)

		try {
			for await (const _chunk of wrapper.execute({ command: "fake-cli", args: [], cwd: "/tmp" }, createTranslator())) {
				// exhaust stream
			}
			throw new Error("expected wrapper to throw")
		} catch (error) {
			expect(error).to.be.instanceOf(Error)
			expect((error as Error).message).to.include("fake-cli failed (non_zero_exit)")
			expect((error as Error).message).to.include("boom")
		}
	})
})
