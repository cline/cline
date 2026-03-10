import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: React is needed for JSX
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRefreshRules = vi.fn()
vi.mock("@/core/controller/file/refreshRules", () => ({
	refreshRules: (...args: unknown[]) => mockRefreshRules(...args),
}))

vi.mock("@/core/controller/file/toggleClineRule", () => ({
	toggleClineRule: vi.fn(),
}))

vi.mock("@shared/proto/cline/file", () => ({
	RuleScope: { GLOBAL: 0, LOCAL: 1 },
}))

vi.mock("../context/StdinContext", () => ({
	useStdinContext: () => ({ isRawModeSupported: true }),
}))

import { RulesPanelContent } from "./RulesPanelContent"

const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

describe("RulesPanelContent", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the basename for Windows rule paths", async () => {
		mockRefreshRules.mockResolvedValue({
			globalClineRulesToggles: {
				toggles: {
					"C:\\workspace\\.clinerules\\rules\\architecture.md": true,
				},
			},
		})

		const { lastFrame } = render(<RulesPanelContent controller={{} as any} onClose={vi.fn()} />)
		await delay()

		const frame = lastFrame() || ""
		expect(frame).toContain("architecture.md")
		expect(frame).not.toContain("C:\\workspace")
	})
})
