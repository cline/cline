import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from "undici"
import { describe, expect, it } from "vitest"
import { withUnlimitedBodyTimeout } from "./net"

class RecordingDispatcher extends Dispatcher {
	calls: Dispatcher.DispatchOptions[] = []

	override dispatch(options: Dispatcher.DispatchOptions, _handler: Dispatcher.DispatchHandler): boolean {
		this.calls.push(options)
		return true
	}

	override async close() {}
	override async destroy() {}
}

type InitWithDispatcher = RequestInit & { dispatcher?: Dispatcher }

describe("withUnlimitedBodyTimeout", () => {
	it("disables bodyTimeout without touching headersTimeout, and still dispatches through the active dispatcher", async () => {
		const recordingDispatcher = new RecordingDispatcher()
		const originalDispatcher = getGlobalDispatcher()
		setGlobalDispatcher(recordingDispatcher)

		try {
			const wrapped = withUnlimitedBodyTimeout((async (_input, init) => {
				// Simulate what undici's real fetch does internally: hand the
				// request off to whatever dispatcher was passed in `init`.
				;(init as InitWithDispatcher | undefined)?.dispatcher?.dispatch(
					{ path: "/v1/chat/completions", method: "POST", headersTimeout: 300_000 },
					{} as Dispatcher.DispatchHandler,
				)
				return new Response("ok")
			}) as typeof fetch)

			await wrapped("http://localhost:1234/v1/chat/completions")

			expect(recordingDispatcher.calls).toHaveLength(1)
			// The only thing this wrapper is allowed to change.
			expect(recordingDispatcher.calls[0]).toMatchObject({ bodyTimeout: 0 })
			// headersTimeout (a different failure mode: the server never
			// responds at all) must pass through untouched.
			expect(recordingDispatcher.calls[0].headersTimeout).toBe(300_000)
		} finally {
			setGlobalDispatcher(originalDispatcher)
		}
	})

	it("does not swap out the active dispatcher, so proxy configuration (EnvHttpProxyAgent) is preserved", async () => {
		const recordingDispatcher = new RecordingDispatcher()
		const originalDispatcher = getGlobalDispatcher()
		setGlobalDispatcher(recordingDispatcher)

		try {
			const wrapped = withUnlimitedBodyTimeout((async (_input, init) => {
				;(init as InitWithDispatcher | undefined)?.dispatcher?.dispatch(
					{ path: "/v1/chat/completions", method: "POST" },
					{} as Dispatcher.DispatchHandler,
				)
				return new Response("ok")
			}) as typeof fetch)

			await wrapped("http://localhost:1234/v1/chat/completions")

			// If this wrapper replaced the dispatcher with a fresh plain Agent
			// instead of composing on top of the active one, our
			// RecordingDispatcher would never see the call.
			expect(recordingDispatcher.calls).toHaveLength(1)
		} finally {
			setGlobalDispatcher(originalDispatcher)
		}
	})
})
