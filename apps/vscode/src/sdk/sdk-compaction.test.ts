import { beforeEach, describe, expect, it, vi } from "vitest"
import { compactSessionMessages } from "./sdk-compaction"

const createContextCompactionPrepareTurn = vi.fn()
vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: (...args: unknown[]) => createContextCompactionPrepareTurn(...args),
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

const baseConfig = {
	providerConfig: { providerId: "anthropic", modelId: "claude" },
	providerId: "anthropic",
	modelId: "claude",
	knownModels: { claude: { id: "claude", maxInputTokens: 200_000 } },
	compaction: undefined,
	logger: undefined,
	telemetry: undefined,
} as unknown as Parameters<typeof compactSessionMessages>[0]["config"]

describe("compactSessionMessages", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns compacted=false without invoking the SDK when there are no messages", async () => {
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages: [] })

		expect(result).toEqual({ compacted: false, messages: [] })
		expect(createContextCompactionPrepareTurn).not.toHaveBeenCalled()
	})

	it("builds a manual-mode prepareTurn and force-enables compaction", async () => {
		const compact = vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] })
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const messages = [
			{ role: "user" as const, content: "1" },
			{ role: "assistant" as const, content: "2" },
		]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		// Manual mode + enabled compaction + telemetry keying.
		expect(createContextCompactionPrepareTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude",
				compaction: expect.objectContaining({ enabled: true }),
				sessionId: "s1",
			}),
			{ mode: "manual" },
		)
		expect(compact).toHaveBeenCalledOnce()
		expect(result).toEqual({ compacted: true, messages: [{ role: "user", content: "summary" }] })
	})

	it("returns compacted=false when prepareTurn is unavailable", async () => {
		createContextCompactionPrepareTurn.mockReturnValueOnce(undefined)

		const messages = [{ role: "user" as const, content: "1" }]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		expect(result).toEqual({ compacted: false, messages })
	})

	it("returns compacted=false when the strategy declines (returns undefined)", async () => {
		const compact = vi.fn().mockResolvedValue(undefined)
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const messages = [{ role: "user" as const, content: "1" }]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		expect(result).toEqual({ compacted: false, messages })
	})
})
