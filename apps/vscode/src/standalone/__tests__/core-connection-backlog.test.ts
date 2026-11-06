// The forward queue behind cline/cline#15031: a streaming handler that posts
// fire-and-forget (as sendStateUpdate does) while the host drains slowly keeps
// every posted response queued, and the backlog tracker is what makes that
// depth visible. The "all of them are still written" assertion documents the
// current, un-coalesced behaviour; the fix flips it.
import { describe, expect, it } from "bun:test"
import type { CoreConnectionMessage } from "@generated/grpc-js/host/core_connection"
import { StreamBacklog } from "../core-connection-backlog"
import { dispatchCoreConnectionRequest } from "../core-connection-protocol"

const METHOD = "cline.StateService.subscribeToState"
const POSTS = 50

function streamRequest() {
	return {
		requestId: "state-1",
		service: "cline.StateService",
		method: "subscribeToState",
		messageJson: "{}",
		isStreaming: true,
	}
}

describe("core connection stream backlog (cline/cline#15031)", () => {
	it("counts every posted response as queued until the host consumes it", async () => {
		let releaseFirstWrite!: () => void
		const firstWriteGate = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve
		})
		const completedSeqs: number[] = []
		let writes = 0
		const write = async (message: CoreConnectionMessage) => {
			const response = message.response!
			const seq = JSON.parse(new TextDecoder().decode(response.messageJsonChunk)).seq
			if (response.messageJsonComplete) {
				completedSeqs.push(seq)
			}
			if (writes++ === 0) {
				await firstWriteGate
			}
		}
		const backlog = new StreamBacklog()

		let settled = 0
		await dispatchCoreConnectionRequest(
			write,
			streamRequest(),
			() => true,
			async (postMessage) => {
				for (let seq = 0; seq < POSTS; seq++) {
					void postMessage({
						type: "grpc_response",
						grpc_response: { request_id: "state-1", message: { seq }, is_streaming: true },
					}).then(() => settled++)
				}
			},
			backlog,
		)

		// Host stuck on the first chunk: everything else is queued, and the
		// tracker sees the whole backlog.
		await Bun.sleep(10)
		expect(writes).toBe(1)
		expect(settled).toBe(0)
		expect(backlog.depth(METHOD)).toBe(POSTS)
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, POSTS]]))

		// Host catches up: nothing coalesces, every stale response is still
		// written in order, and the queue empties.
		releaseFirstWrite()
		while (settled < POSTS) {
			await Bun.sleep(5)
		}
		expect(completedSeqs).toEqual(Array.from({ length: POSTS }, (_, i) => i))
		expect(backlog.depth(METHOD)).toBe(0)
		// The window they drained in still peaked at its starting depth; the next,
		// quiet one is reported as 0 once; then the method drops out.
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, POSTS]]))
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 0]]))
		expect(backlog.takePeaks()).toEqual(new Map())
	})

	it("leaves the queue when a forward fails, and does not track unary requests", async () => {
		const backlog = new StreamBacklog()
		const failingWrite = async () => {
			throw new Error("host gone")
		}
		await dispatchCoreConnectionRequest(
			failingWrite,
			streamRequest(),
			() => true,
			async (postMessage) => {
				await postMessage({
					type: "grpc_response",
					grpc_response: { request_id: "state-1", message: { seq: 0 }, is_streaming: true },
				}).catch(() => {})
			},
			backlog,
		)
		expect(backlog.depth(METHOD)).toBe(0)
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 1]]))

		await dispatchCoreConnectionRequest(
			async () => {},
			{ ...streamRequest(), requestId: "unary-1", method: "getLatestState", isStreaming: false },
			() => false,
			async (postMessage) => {
				await postMessage({ type: "grpc_response", grpc_response: { request_id: "unary-1", message: {} } })
			},
			backlog,
		)
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 0]]))
	})

	it("reports each window's peak, carrying an undrained backlog into the next", () => {
		const backlog = new StreamBacklog()
		backlog.enter(METHOD)
		backlog.enter(METHOD)
		backlog.enter(METHOD)
		backlog.leave(METHOD)
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 3]]))
		// Two are still queued: the next window starts at that depth, not zero.
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 2]]))
		backlog.leave(METHOD)
		backlog.leave(METHOD)
		// The window in which they drained still peaked at the depth it started with.
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 2]]))
		// First quiet window: reported as 0 so the reader sees the recovery.
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 0]]))
		// Still quiet: the method drops out of the report.
		expect(backlog.takePeaks()).toEqual(new Map())
		// Activity brings it back; its next quiet window is again a single 0.
		backlog.enter(METHOD)
		backlog.leave(METHOD)
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 1]]))
		expect(backlog.takePeaks()).toEqual(new Map([[METHOD, 0]]))
		expect(backlog.takePeaks()).toEqual(new Map())
	})
})
