import type { ApiStream, ApiStreamChunk, ApiStreamUsageChunk } from "@core/api/transform/stream"
import { describe, it } from "mocha"
import "should"
import sinon from "sinon"

import { StreamChunkCoordinator, StreamIdleTimeoutError } from "../StreamChunkCoordinator"

type DeferredNext = {
	resolve: (result: IteratorResult<ApiStreamChunk>) => void
	reject: (err: unknown) => void
}

interface ControllableStream {
	stream: ApiStream
	pushChunk: (chunk: ApiStreamChunk) => void
	complete: () => void
	fail: (err: unknown) => void
	returnCalled: () => boolean
}

/**
 * Builds a minimal async iterator that lets the test decide exactly when each
 * iterator.next() call resolves/rejects. This mirrors how a real Provider
 * stream behaves: the coordinator awaits iterator.next() and we control the
 * timing of each chunk delivery.
 */
function createControllableStream(): ControllableStream {
	const buffered: IteratorResult<ApiStreamChunk>[] = []
	let bufferedError: { err: unknown } | undefined
	let pending: DeferredNext | undefined
	let returned = false

	const iter: AsyncGenerator<ApiStreamChunk> = {
		next(): Promise<IteratorResult<ApiStreamChunk>> {
			if (bufferedError) {
				const { err } = bufferedError
				bufferedError = undefined
				return Promise.reject(err)
			}
			if (buffered.length > 0) {
				return Promise.resolve(buffered.shift()!)
			}
			return new Promise<IteratorResult<ApiStreamChunk>>((resolve, reject) => {
				pending = { resolve, reject }
			})
		},
		return(value?: unknown): Promise<IteratorResult<ApiStreamChunk>> {
			returned = true
			if (pending) {
				const p = pending
				pending = undefined
				p.resolve({ value: undefined as unknown as ApiStreamChunk, done: true })
			}
			return Promise.resolve({ value: value as ApiStreamChunk, done: true })
		},
		throw(err: unknown): Promise<IteratorResult<ApiStreamChunk>> {
			if (pending) {
				const p = pending
				pending = undefined
				p.reject(err)
			}
			return Promise.reject(err)
		},
		[Symbol.asyncIterator]() {
			return this
		},
	}

	return {
		stream: iter as ApiStream,
		pushChunk: (chunk) => {
			if (pending) {
				const p = pending
				pending = undefined
				p.resolve({ value: chunk, done: false })
				return
			}
			buffered.push({ value: chunk, done: false })
		},
		complete: () => {
			if (pending) {
				const p = pending
				pending = undefined
				p.resolve({ value: undefined as unknown as ApiStreamChunk, done: true })
				return
			}
			buffered.push({ value: undefined as unknown as ApiStreamChunk, done: true })
		},
		fail: (err) => {
			if (pending) {
				const p = pending
				pending = undefined
				p.reject(err)
				return
			}
			bufferedError = { err }
		},
		returnCalled: () => returned,
	}
}

describe("StreamChunkCoordinator", () => {
	it("forwards non-usage chunks in FIFO order when no idle timeout is configured", async () => {
		const ctrl = createControllableStream()
		const onUsageChunk = sinon.spy()
		const coordinator = new StreamChunkCoordinator(ctrl.stream, { onUsageChunk })

		ctrl.pushChunk({ type: "text", text: "hello" })
		ctrl.pushChunk({ type: "text", text: "world" })
		ctrl.complete()

		const first = await coordinator.nextChunk()
		first!.type.should.equal("text")
		;(first as { type: "text"; text: string }).text.should.equal("hello")

		const second = await coordinator.nextChunk()
		;(second as { type: "text"; text: string }).text.should.equal("world")

		const end = await coordinator.nextChunk()
		;(end === undefined).should.equal(true)

		onUsageChunk.callCount.should.equal(0)
		await coordinator.waitForCompletion()
	})

	it("routes usage chunks to onUsageChunk without enqueueing them for consumers", async () => {
		const ctrl = createControllableStream()
		const onUsageChunk = sinon.spy()
		const coordinator = new StreamChunkCoordinator(ctrl.stream, { onUsageChunk })

		const usage: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.0001,
		}
		ctrl.pushChunk(usage)
		ctrl.pushChunk({ type: "text", text: "done" })
		ctrl.complete()

		const chunk = await coordinator.nextChunk()
		;(chunk as { type: "text"; text: string }).text.should.equal("done")
		;((await coordinator.nextChunk()) === undefined).should.equal(true)

		onUsageChunk.calledOnce.should.equal(true)
		onUsageChunk.firstCall.args[0].should.deepEqual(usage)
	})

	it("propagates iterator errors via nextChunk()", async () => {
		const ctrl = createControllableStream()
		const coordinator = new StreamChunkCoordinator(ctrl.stream, { onUsageChunk: sinon.spy() })

		ctrl.fail(new Error("upstream failure"))

		let caught: unknown
		try {
			await coordinator.nextChunk()
		} catch (e) {
			caught = e
		}
		;(caught as Error).message.should.equal("upstream failure")
	})

	it("throws StreamIdleTimeoutError when no chunk arrives within idleTimeoutMs", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const ctrl = createControllableStream()
			const coordinator = new StreamChunkCoordinator(ctrl.stream, {
				onUsageChunk: sinon.spy(),
				idleTimeoutMs: 1000,
			})

			const pendingChunk = coordinator.nextChunk().then(
				(value) => ({ ok: true as const, value }),
				(error: unknown) => ({ ok: false as const, error }),
			)
			// Let the pump register its timeout before we advance time.
			await clock.tickAsync(0)
			await clock.tickAsync(1000)

			const outcome = await pendingChunk
			outcome.ok.should.equal(false)
			;((outcome as { ok: false; error: unknown }).error instanceof StreamIdleTimeoutError).should.equal(true)
			;(outcome as { ok: false; error: Error }).error.message.should.match(/1000ms/)

			// Further nextChunk() calls should keep surfacing the same error instead of hanging.
			const secondOutcome = await coordinator.nextChunk().then(
				() => ({ ok: true as const }),
				(error: unknown) => ({ ok: false as const, error }),
			)
			secondOutcome.ok.should.equal(false)
			;((secondOutcome as { ok: false; error: unknown }).error instanceof StreamIdleTimeoutError).should.equal(true)
		} finally {
			clock.restore()
		}
	})

	it("resets the idle window for each chunk so slow but steady streams succeed", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const ctrl = createControllableStream()
			const coordinator = new StreamChunkCoordinator(ctrl.stream, {
				onUsageChunk: sinon.spy(),
				idleTimeoutMs: 1000,
			})

			// Arm the pump's first timeout.
			await clock.tickAsync(0)
			// Chunk arrives just before the idle window elapses.
			await clock.tickAsync(900)
			ctrl.pushChunk({ type: "text", text: "a" })
			const first = await coordinator.nextChunk()
			;(first as { type: "text"; text: string }).text.should.equal("a")

			// Another 900ms — under the per-chunk budget — still counts as "alive".
			await clock.tickAsync(900)
			ctrl.pushChunk({ type: "text", text: "b" })
			const second = await coordinator.nextChunk()
			;(second as { type: "text"; text: string }).text.should.equal("b")

			ctrl.complete()
			;((await coordinator.nextChunk()) === undefined).should.equal(true)
		} finally {
			clock.restore()
		}
	})

	it("resets the idle window after usage chunks so they do not starve content chunks", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const ctrl = createControllableStream()
			const onUsageChunk = sinon.spy()
			const coordinator = new StreamChunkCoordinator(ctrl.stream, {
				onUsageChunk,
				idleTimeoutMs: 1000,
			})

			await clock.tickAsync(0)
			await clock.tickAsync(500)
			ctrl.pushChunk({
				type: "usage",
				inputTokens: 1,
				outputTokens: 1,
			})
			// Yield so the pump can process the usage chunk and re-arm its timer.
			await clock.tickAsync(0)
			await clock.tickAsync(900)
			ctrl.pushChunk({ type: "text", text: "after-usage" })

			const chunk = await coordinator.nextChunk()
			;(chunk as { type: "text"; text: string }).text.should.equal("after-usage")
			onUsageChunk.callCount.should.equal(1)

			ctrl.complete()
			;((await coordinator.nextChunk()) === undefined).should.equal(true)
		} finally {
			clock.restore()
		}
	})

	it("stop() unblocks cleanly after an idle timeout and closes the iterator", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const ctrl = createControllableStream()
			const coordinator = new StreamChunkCoordinator(ctrl.stream, {
				onUsageChunk: sinon.spy(),
				idleTimeoutMs: 500,
			})

			const pendingChunk = coordinator.nextChunk().then(
				() => ({ ok: true as const }),
				(error: unknown) => ({ ok: false as const, error }),
			)
			await clock.tickAsync(0)
			await clock.tickAsync(500)

			const outcome = await pendingChunk
			outcome.ok.should.equal(false)
			;((outcome as { ok: false; error: unknown }).error instanceof StreamIdleTimeoutError).should.equal(true)

			const stopPromise = coordinator.stop()
			await clock.tickAsync(0)
			await stopPromise

			ctrl.returnCalled().should.equal(true)
		} finally {
			clock.restore()
		}
	})

	it("does not leak timers after stop() when idle timeout is configured", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const ctrl = createControllableStream()
			const coordinator = new StreamChunkCoordinator(ctrl.stream, {
				onUsageChunk: sinon.spy(),
				idleTimeoutMs: 5_000,
			})

			// Let the pump enter its first await and arm the idle timer.
			await clock.tickAsync(0)
			clock.countTimers().should.be.greaterThan(0)

			await coordinator.stop()
			await clock.tickAsync(0)
			clock.countTimers().should.equal(0)
		} finally {
			clock.restore()
		}
	})

	it("does not register any timer when idleTimeoutMs is not provided", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const ctrl = createControllableStream()
			const coordinator = new StreamChunkCoordinator(ctrl.stream, { onUsageChunk: sinon.spy() })

			await clock.tickAsync(0)
			clock.countTimers().should.equal(0)

			// Advancing well past any reasonable idle threshold must not trigger anything.
			await clock.tickAsync(10 * 60_000)
			clock.countTimers().should.equal(0)

			ctrl.pushChunk({ type: "text", text: "late" })
			const chunk = await coordinator.nextChunk()
			;(chunk as { type: "text"; text: string }).text.should.equal("late")

			ctrl.complete()
			await coordinator.waitForCompletion()
		} finally {
			clock.restore()
		}
	})
})
