// npx jest src/integrations/terminal/__tests__/mergePromise.test.ts

import { TerminalProcess } from "../TerminalProcess"
import { mergePromise } from "../mergePromise"

describe("mergePromise", () => {
	it("merges promise methods with terminal process", async () => {
		const process = new TerminalProcess(100 * 1024)
		const promise = Promise.resolve()

		const merged = mergePromise(process, promise)

		expect(merged).toHaveProperty("then")
		expect(merged).toHaveProperty("catch")
		expect(merged).toHaveProperty("finally")
		expect(merged instanceof TerminalProcess).toBe(true)

		await expect(merged).resolves.toBeUndefined()
	})
})
