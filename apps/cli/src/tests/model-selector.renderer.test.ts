import { jsx } from "@opentui/react/jsx-runtime";
import { testRender } from "@opentui/react/test-utils";
import {
	type ChoiceContext,
	DialogProvider,
	useDialog,
} from "@opentui-ui/dialog/react";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ModelOption,
	ModelSelectorContent,
} from "../tui/components/model-selector/model-selector";

function ModelSelectorDialog({ models }: { models: ModelOption[] }) {
	const dialog = useDialog();
	useEffect(() => {
		void dialog.choice<string>({
			content: (ctx: ChoiceContext<string>) =>
				jsx(ModelSelectorContent, {
					...ctx,
					currentModel: "gpt-6-astra",
					currentProviderName: "OpenAI",
					models,
				}),
		});
	}, [dialog]);
	return jsx("text", { children: "Open /model" });
}

describe("ModelSelectorContent renderer regression", () => {
	let renderer: Awaited<ReturnType<typeof testRender>>["renderer"] | undefined;

	afterEach(async () => {
		await act(async () => {
			renderer?.destroy();
		});
		renderer = undefined;
	});

	it.each([
		["zero", 0, undefined],
		["positive", 128_000, "128K"],
		["undefined", undefined, undefined],
	] as const)("renders /model with %s maxInputTokens", async (_case, maxInputTokens, tokenText) => {
		const models: ModelOption[] = [
			{
				key: "gpt-6-astra",
				name: "gpt-6-astra",
				maxInputTokens,
				supportsReasoning: false,
			},
		];
		const setup = await testRender(
			jsx(DialogProvider, { children: jsx(ModelSelectorDialog, { models }) }),
			{ width: 100, height: 30 },
		);
		renderer = setup.renderer;

		await act(async () => {
			await setup.flush();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Select Model");
		expect(frame).toContain("gpt-6-astra");
		expect(frame).toContain("(current)");
		if (tokenText) expect(frame).toContain(tokenText);
		else expect(frame).not.toContain("0");
	});
});
