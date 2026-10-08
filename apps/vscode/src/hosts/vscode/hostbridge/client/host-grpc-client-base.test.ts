import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { Logger } from "@/shared/services/Logger"

// The module under test instantiates GrpcHandler, whose real implementation
// pulls in the generated vscode host handlers (and therefore the `vscode`
// module). Mock it before importing createGrpcClient.
const handleRequestMock = mock()
mock.module("@/hosts/vscode/hostbridge-grpc-handler", () => ({
	GrpcHandler: class {
		handleRequest = handleRequestMock
	},
}))

import { createGrpcClient } from "./host-grpc-client-base"

const testService = {
	name: "TestService",
	fullName: "host.TestService",
	methods: {
		subscribeToThing: {
			name: "SubscribeToThing",
			requestType: Object,
			responseType: Object,
			requestStream: false,
			responseStream: true,
			options: {},
		},
		getThing: {
			name: "GetThing",
			requestType: Object,
			responseType: Object,
			requestStream: false,
			responseStream: false,
			options: {},
		},
		debugLog: {
			name: "DebugLog",
			requestType: Object,
			responseType: Object,
			requestStream: false,
			responseStream: false,
			options: {},
		},
	},
}

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve()
	}
}

describe("createGrpcClient", () => {
	beforeEach(() => {
		handleRequestMock.mockReset()
	})

	describe("streaming methods", () => {
		it("returns a cancel function synchronously, not a Promise", () => {
			// Regression test: the streaming client used to return the async IIFE's
			// Promise. Callers storing it as an unsubscribe function then crashed
			// with "... is not a function" (e.g. VscodeTelemetryPolicyService.dispose
			// when the webview moved between sidebars).
			handleRequestMock.mockResolvedValue(() => {})
			const client = createGrpcClient(testService) as any

			const unsubscribe = client.subscribeToThing({}, { onResponse: () => {} })

			expect(typeof unsubscribe).toBe("function")
			expect(unsubscribe).not.toBeInstanceOf(Promise)
			// Must not throw when invoked immediately, before the underlying
			// handler promise has resolved.
			expect(() => unsubscribe()).not.toThrow()
		})

		it("invokes the underlying cancel function once it resolves", async () => {
			const cancel = mock()
			let resolveHandler: (value: () => void) => void = () => {}
			handleRequestMock.mockReturnValue(
				new Promise<() => void>((resolve) => {
					resolveHandler = resolve
				}),
			)
			const client = createGrpcClient(testService) as any

			const unsubscribe = client.subscribeToThing({}, { onResponse: () => {} })
			unsubscribe()
			expect(cancel).toHaveBeenCalledTimes(0)

			resolveHandler(cancel)
			await flushMicrotasks()
			expect(cancel).toHaveBeenCalledTimes(1)
		})

		it("reports handler errors through onError and still returns a safe cancel function", async () => {
			const onError = mock()
			handleRequestMock.mockRejectedValue(new Error("stream setup failed"))
			const client = createGrpcClient(testService) as any

			const unsubscribe = client.subscribeToThing({}, { onResponse: () => {}, onError })
			await flushMicrotasks()

			expect(onError).toHaveBeenCalledTimes(1)
			expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
			expect(() => unsubscribe()).not.toThrow()
			await flushMicrotasks()
		})
	})

	describe("unary methods", () => {
		it("resolves with the handler response", async () => {
			handleRequestMock.mockResolvedValue({ value: 42 })
			const client = createGrpcClient(testService) as any

			const response = await client.getThing({})

			expect(response).toEqual({ value: 42 })
			expect(handleRequestMock).toHaveBeenCalledWith("host.TestService", "getThing", {}, expect.any(String))
		})
	})

	describe("debugLog recursion guard", () => {
		// Regression for the closed-output-channel logging loop on code-server
		// logout. When the `debugLog` gRPC method fails (the output channel was
		// disposed), logging that failure through `Logger.log` → `debugLog`
		// re-entered the same closed channel and recursively flooded shutdown.
		// The fix skips the `Logger.log` call specifically for the `debugLog`
		// method, so a debugLog failure never logs itself through debugLog.
		const loggerLog = mock()
		const loggerError = mock()
		const originalLog = Logger.log
		const originalError = Logger.error

		beforeEach(() => {
			loggerLog.mockReset()
			loggerError.mockReset()
			Logger.log = loggerLog
			Logger.error = loggerError
		})

		afterEach(() => {
			Logger.log = originalLog
			Logger.error = originalError
		})

		it("does NOT Logger.log a failed debugLog request (prevents the recursion)", async () => {
			handleRequestMock.mockRejectedValue(new Error("Channel has been closed"))
			const client = createGrpcClient(testService) as any

			await expect(client.debugLog({ value: "x" })).rejects.toThrow("Channel has been closed")
			// The guard skips the log for the debugLog method — this is the fix.
			expect(loggerLog).toHaveBeenCalledTimes(0)
		})

		it("still Logger.log a failed non-debugLog unary request (unchanged behavior)", async () => {
			handleRequestMock.mockRejectedValue(new Error("boom"))
			const client = createGrpcClient(testService) as any

			await expect(client.getThing({})).rejects.toThrow("boom")
			// Other unary methods keep their diagnostic logging.
			expect(loggerLog).toHaveBeenCalledTimes(1)
			expect(String(loggerLog.mock.calls[0][0])).toContain("host.TestService.getThing")
			expect(String(loggerLog.mock.calls[0][0])).toContain("boom")
		})
	})
})
