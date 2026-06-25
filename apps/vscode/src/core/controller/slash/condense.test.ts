import { strict as assert } from "node:assert"
import { StringRequest } from "@shared/proto/cline/common"
import { describe, it, vi } from "vitest"
import type { Controller } from ".."
import { condense } from "./condense"

describe("condense slash handler", () => {
	it("runs controller compaction instead of answering the old condense prompt", async () => {
		const compactTask = vi.fn().mockResolvedValue(undefined)
		const handleWebviewAskResponse = vi.fn()
		const controller = {
			compactTask,
			task: { handleWebviewAskResponse },
		} as unknown as Controller

		await condense(controller, StringRequest.create({ value: "compact" }))

		assert.equal(compactTask.mock.calls.length, 1)
		assert.equal(handleWebviewAskResponse.mock.calls.length, 0)
	})
})
