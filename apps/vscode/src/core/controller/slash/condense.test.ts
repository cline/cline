import { StringRequest } from "@shared/proto/cline/common"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { condense } from "./condense"

describe("condense slash handler", () => {
	it("runs controller compaction instead of answering the old condense prompt", async () => {
		const handleWebviewAskResponse = vi.fn()
		const controller = {
			compactTask: vi.fn().mockResolvedValue(undefined),
			task: { handleWebviewAskResponse },
		} as unknown as Controller

		await condense(controller, StringRequest.create({ value: "compact" }))

		expect(controller.compactTask).toHaveBeenCalledOnce()
		expect(handleWebviewAskResponse).not.toHaveBeenCalled()
	})
})
