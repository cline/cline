import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ANTHROPIC_COMPUTER_USE_BETA_2024,
	ANTHROPIC_COMPUTER_USE_BETA_2025,
	createAnthropicProviderModule,
	withComputerUseBetaHeader,
} from "./anthropic";

const createAnthropicMock = vi.hoisted(() => vi.fn());
const anthropicModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "anthropic", modelId })),
);

vi.mock("@ai-sdk/anthropic", () => ({
	createAnthropic: createAnthropicMock,
}));

describe("createAnthropicProviderModule", () => {
	beforeEach(() => {
		createAnthropicMock.mockReset();
		createAnthropicMock.mockReturnValue(anthropicModelMock);
		anthropicModelMock.mockClear();
	});

	it("passes custom base URLs to Anthropic-compatible providers", async () => {
		const provider = await createAnthropicProviderModule(
			config({
				apiKey: "minimax-api-key",
				baseUrl: "https://api.minimax.io/anthropic",
			}),
			context("minimax"),
		);

		provider.model("MiniMax-M2.5");

		expect(createAnthropicMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "minimax-api-key",
				baseURL: "https://api.minimax.io/anthropic",
				name: "minimax",
			}),
		);
		expect(anthropicModelMock).toHaveBeenCalledWith("MiniMax-M2.5");
	});

	it("always attaches the computer-use beta header (prototype hack)", async () => {
		await createAnthropicProviderModule(
			config({ apiKey: "k", baseUrl: "https://api.anthropic.com" }),
			context("anthropic"),
		);

		const passed = createAnthropicMock.mock.calls[0]?.[0] as {
			headers?: Record<string, string>;
		};
		expect(passed.headers?.["anthropic-beta"]).toBe(
			ANTHROPIC_COMPUTER_USE_BETA_2025,
		);
	});

	it("preserves and merges a caller-supplied anthropic-beta header", async () => {
		await createAnthropicProviderModule(
			config({
				apiKey: "k",
				headers: { "anthropic-beta": "context-1m-2025-08-07" },
			}),
			context("anthropic"),
		);

		const passed = createAnthropicMock.mock.calls[0]?.[0] as {
			headers?: Record<string, string>;
		};
		expect(passed.headers?.["anthropic-beta"]).toBe(
			`context-1m-2025-08-07,${ANTHROPIC_COMPUTER_USE_BETA_2025}`,
		);
	});
});

describe("withComputerUseBetaHeader", () => {
	it("adds the 2025 beta when no headers are present", () => {
		expect(withComputerUseBetaHeader(undefined)).toEqual({
			"anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA_2025,
		});
	});

	it("supports the 2024 beta variant", () => {
		expect(
			withComputerUseBetaHeader(undefined, ANTHROPIC_COMPUTER_USE_BETA_2024),
		).toEqual({ "anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA_2024 });
	});

	it("does not duplicate an already-present beta value", () => {
		expect(
			withComputerUseBetaHeader({
				"anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA_2025,
			}),
		).toEqual({ "anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA_2025 });
	});

	it("merges with a differently-cased existing header without duplicating", () => {
		const result = withComputerUseBetaHeader({
			"Anthropic-Beta": "context-1m-2025-08-07",
		});
		expect(result["anthropic-beta"]).toBe(
			`context-1m-2025-08-07,${ANTHROPIC_COMPUTER_USE_BETA_2025}`,
		);
		expect(result).not.toHaveProperty("Anthropic-Beta");
	});

	it("keeps other headers untouched", () => {
		expect(
			withComputerUseBetaHeader({ "x-custom": "1" }),
		).toEqual({
			"x-custom": "1",
			"anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA_2025,
		});
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "minimax",
		...overrides,
	};
}

function context(providerId: string): GatewayProviderContext {
	return {
		provider: {
			id: providerId,
			name: "MiniMax",
			defaultModelId: "MiniMax-M2.5",
			models: [],
		},
		model: {
			providerId,
			id: "MiniMax-M2.5",
			name: "MiniMax-M2.5",
		},
		config: config({}),
	};
}