import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	reconcilePortableReasoning,
	resolvePortableReasoning,
} from "./portable-reasoning";
import { composeAiSdkProviderOptions } from "./provider-options";

function context(
	family: string,
	reasoningOptions: readonly ModelReasoningOption[] = [{ type: "toggle" }],
	providerId = "chutes",
): GatewayProviderContext {
	return {
		provider: { id: providerId, name: providerId, models: [] },
		model: {
			id: "example/model",
			name: "Display names do not determine wire controls",
			providerId,
			capabilities: ["text", "reasoning"],
			reasoningOptions,
			metadata: { family },
		},
		config: { providerId },
	};
}

function request(
	enabled: boolean,
	providerId = "chutes",
): GatewayStreamRequest {
	return {
		providerId,
		modelId: "example/model",
		messages: [],
		reasoning: { enabled },
	};
}

describe("Chutes reasoning wire translation", () => {
	it.each([
		["kimi-k2", "thinking"],
		["kimi-k3", "thinking"],
		["glm", "thinking"],
		["deepseek", "thinking"],
		["deepseek-flash", "thinking"],
		["gemma", "enable_thinking"],
		["qwen3", "enable_thinking"],
	] as const)("maps %s toggles to %s", (family, field) => {
		for (const enabled of [false, true]) {
			const input = request(enabled);
			const options = composeAiSdkProviderOptions(input, context(family));
			expect(options.chutes).toMatchObject({
				chat_template_kwargs: { [field]: enabled },
			});
			expect(
				reconcilePortableReasoning(resolvePortableReasoning(input), options),
			).toBeUndefined();
		}
	});

	it.each([
		"kimi-k2",
		"kimi-k3",
		"glm",
		"qwen3",
	])("does not invent a toggle for mandatory-thinking %s", (family) => {
		for (const enabled of [false, true]) {
			const options = composeAiSdkProviderOptions(
				request(enabled),
				context(family, []),
			);
			expect(options.chutes).not.toHaveProperty("chat_template_kwargs");
		}
	});

	it("preserves earlier thinking only for enabled Kimi K2", () => {
		const enabled = composeAiSdkProviderOptions(
			request(true),
			context("kimi-k2"),
		);
		expect(enabled.chutes?.chat_template_kwargs).toEqual({
			thinking: true,
			preserve_thinking: true,
		});
		const disabled = composeAiSdkProviderOptions(
			request(false),
			context("kimi-k2"),
		);
		expect(disabled.chutes?.chat_template_kwargs).toEqual({ thinking: false });
		const sibling = composeAiSdkProviderOptions(
			request(true),
			context("kimi-k3"),
		);
		expect(sibling.chutes?.chat_template_kwargs).toEqual({ thinking: true });
	});

	it("uses model facts rather than a display-name heuristic", () => {
		const modelContext = context("qwen3");
		modelContext.model.name = "Mandatory Thinking Model";
		expect(
			composeAiSdkProviderOptions(request(false), modelContext).chutes,
		).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
	});

	it("does not change another provider or an unrelated family", () => {
		const other = composeAiSdkProviderOptions(
			request(false, "openrouter"),
			context("qwen3", [{ type: "toggle" }], "openrouter"),
		);
		expect(other.openrouter).not.toHaveProperty("chat_template_kwargs");
		const unrelated = composeAiSdkProviderOptions(
			request(false),
			context("other-family"),
		);
		expect(unrelated.chutes).not.toHaveProperty("chat_template_kwargs");
	});
});
