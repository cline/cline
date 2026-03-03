import { describe, it } from "mocha"
import sinon from "sinon"
import "should"
import { retryWithBackoff } from "./retry"

describe("retryWithBackoff", () => {
	it("returns immediately when operation succeeds on first attempt", async () => {
		const operation = sinon.stub().resolves("ok")
		const onRetry = sinon.stub()

		const result = await retryWithBackoff<string>(operation, {
			operationName: "Immediate success",
			maxAttempts: 3,
			baseDelayMs: 10,
			onRetry,
		})

		result.should.equal("ok")
		operation.callCount.should.equal(1)
		onRetry.callCount.should.equal(0)
	})

	it("retries with exponential backoff until success", async () => {
		const clock = sinon.useFakeTimers()
		try {
			let attempt = 0
			const onRetry = sinon.stub()

			const resultPromise = retryWithBackoff<string>(
				async () => {
					attempt++
					if (attempt < 3) {
						throw new Error(`fail ${attempt}`)
					}
					return "ok"
				},
				{
					operationName: "Backoff retry",
					maxAttempts: 4,
					baseDelayMs: 100,
					onRetry,
				},
			)

			await Promise.resolve()
			attempt.should.equal(1)

			await clock.tickAsync(100)
			attempt.should.equal(2)

			await clock.tickAsync(200)
			const result = await resultPromise
			result.should.equal("ok")

			attempt.should.equal(3)
			onRetry.callCount.should.equal(2)
			onRetry.getCall(0).args[1].should.equal(1)
			onRetry.getCall(0).args[3].should.equal(100)
			onRetry.getCall(1).args[1].should.equal(2)
			onRetry.getCall(1).args[3].should.equal(200)
		} finally {
			clock.restore()
		}
	})

	it("stops retrying when shouldRetry returns false", async () => {
		const operation = sinon.stub().rejects(new Error("stop"))
		const shouldRetry = sinon.stub().returns(false)

		let errorMessage = ""
		try {
			await retryWithBackoff(operation, {
				operationName: "Should retry gate",
				maxAttempts: 5,
				baseDelayMs: 10,
				shouldRetry,
			})
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error)
		}

		operation.callCount.should.equal(1)
		shouldRetry.callCount.should.equal(1)
		errorMessage.should.containEql("Should retry gate failed after 5 attempts")
		errorMessage.should.containEql("stop")
	})

	it("throws after max attempts with operation name and last error", async () => {
		let attempt = 0

		let errorMessage = ""
		try {
			await retryWithBackoff(
				async () => {
					attempt++
					throw new Error(`fail ${attempt}`)
				},
				{
					operationName: "Always fails",
					maxAttempts: 3,
					baseDelayMs: 1,
				},
			)
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error)
		}

		attempt.should.equal(3)
		errorMessage.should.containEql("Always fails failed after 3 attempts")
		errorMessage.should.containEql("fail 3")
	})
})
