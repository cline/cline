import type { Llms } from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import {
	ModelIdInputContent,
	ModelSelectorContent,
	ThinkingLevelContent,
} from "../components/model-selector/model-selector";
import { useModelSelector } from "./use-model-selector";

const coreMocks = vi.hoisted(() => ({
	getProviderConfig: vi.fn(),
	resolveProviderConfig: vi.fn(),
	refreshProviderModelsFromSource: vi.fn(),
}));

vi.mock("@cline/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core")>();
	return {
		...actual,
		Llms: {
			...actual.Llms,
			getProvider: async () => ({ name: "Fixture provider" }),
		},
		ProviderSettingsManager: class {
			getProviderConfig(...args: unknown[]) {
				return coreMocks.getProviderConfig(...args);
			}
		},
		resolveProviderConfig: coreMocks.resolveProviderConfig,
		refreshProviderModelsFromSource: coreMocks.refreshProviderModelsFromSource,
	};
});

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: <T>(callback: T) => callback,
}));

// Dialog content is inspected as React elements without mounting a terminal.
vi.mock("@opentui-ui/dialog/react", () => ({
	useDialogKeyboard: () => undefined,
}));
vi.mock("opentui-spinner/react", () => ({}));
vi.mock("../components/dialogs/loading-dialog", () => ({
	withLoadingDialog: async <T>(
		_dialog: unknown,
		_message: string,
		run: () => Promise<T>,
	) => await run(),
}));

const MODEL_ID = "fixture-reasoning-model";

function setup(
	knownModels: Record<string, Llms.ModelInfo>,
	answers: Array<string | undefined> = [MODEL_ID, "medium"],
) {
	const config: Config = {
		providerId: "openai-compatible",
		modelId: MODEL_ID,
		apiKey: "fixture-key",
		knownModels,
		thinking: true,
		reasoningEffort: "medium",
		verbose: false,
		sandbox: false,
		outputMode: "text",
		mode: "act",
		defaultToolAutoApprove: false,
		toolPolicies: {},
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		cwd: process.cwd(),
		systemPrompt: "",
	};
	coreMocks.getProviderConfig.mockImplementation((providerId: string) => {
		expect(providerId).toBe("openai-compatible");
		return { baseUrl: "http://fixture.invalid/v1", apiKey: "fixture-key" };
	});
	coreMocks.resolveProviderConfig.mockResolvedValue({ knownModels });
	coreMocks.refreshProviderModelsFromSource.mockResolvedValue(undefined);
	const contents: ReactElement<Record<string, unknown>>[] = [];
	const choice = vi.fn(
		async (options: { content: (ctx: ChoiceContext<string>) => ReactNode }) => {
			const content = options.content({
				dialogId: "fixture-dialog",
				resolve: vi.fn(),
				dismiss: vi.fn(),
			} as ChoiceContext<string>);
			if (!isValidElement<Record<string, unknown>>(content)) {
				throw new Error("Expected dialog content to be a React element");
			}
			contents.push(content);
			return answers.shift();
		},
	);
	const onModelChange = vi.fn(async () => ({
		modelId: config.modelId,
		thinking: config.thinking,
		reasoningEffort: config.reasoningEffort,
	}));
	const refocusTextarea = vi.fn();
	// biome-ignore lint/correctness/useHookAtTopLevel: useCallback is mocked to exercise the real selection flow without a renderer.
	const openModelSelector = useModelSelector({
		dialog: { choice } as unknown as DialogActions,
		config,
		termHeight: 30,
		onModelChange: async () => {
			await onModelChange();
		},
		refocusTextarea,
	});
	return {
		config,
		contents,
		onModelChange,
		openModelSelector,
		refocusTextarea,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ data: [{ id: MODEL_ID }] })),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("discovered model selection", () => {
	it("keeps known reasoning metadata and applies the selected medium effort", async () => {
		const knownModels: Record<string, Llms.ModelInfo> = {
			[MODEL_ID]: {
				id: MODEL_ID,
				name: "Fixture Reasoner",
				capabilities: ["reasoning"],
				maxInputTokens: 128_000,
				family: "fixture-family",
			},
		};
		const { contents, onModelChange, openModelSelector } = setup(knownModels);

		await openModelSelector();

		expect(contents.map((content) => content.type)).toEqual([
			ModelSelectorContent,
			ThinkingLevelContent,
		]);
		expect(contents[0]?.props.models).toEqual([
			{
				key: MODEL_ID,
				name: "Fixture Reasoner",
				maxInputTokens: 128_000,
				family: "fixture-family",
				supportsReasoning: true,
			},
		]);
		expect(contents[1]?.props).toMatchObject({
			modelName: "Fixture Reasoner",
			currentLevel: "medium",
		});
		expect(onModelChange).toHaveResolvedWith({
			modelId: MODEL_ID,
			thinking: true,
			reasoningEffort: "medium",
		});
	});

	it.each<{
		name: string;
		knownModels: Record<string, Llms.ModelInfo>;
		displayName: string;
		supportsReasoning: boolean;
	}>([
		{
			name: "a known model without reasoning",
			knownModels: {
				[MODEL_ID]: {
					id: MODEL_ID,
					name: "Fixture Chat",
					capabilities: ["tools"],
				},
			},
			displayName: "Fixture Chat",
			supportsReasoning: false,
		},
		{
			name: "an unknown model with only a similarly named known model",
			knownModels: {
				[`${MODEL_ID}-alias`]: {
					id: `${MODEL_ID}-alias`,
					name: "Other Reasoner",
					capabilities: ["reasoning"],
				},
			},
			displayName: MODEL_ID,
			supportsReasoning: false,
		},
		{
			name: "a known reasoning model without a display name",
			knownModels: {
				[MODEL_ID]: { id: MODEL_ID, capabilities: ["reasoning"] },
			},
			displayName: MODEL_ID,
			supportsReasoning: true,
		},
	])("selects $name", async ({
		knownModels,
		displayName,
		supportsReasoning,
	}) => {
		const { contents, onModelChange, openModelSelector } = setup(knownModels);

		await openModelSelector();

		expect(contents[0]?.type).toBe(ModelSelectorContent);
		expect(contents[0]?.props.models).toEqual([
			expect.objectContaining({
				key: MODEL_ID,
				name: displayName,
				supportsReasoning,
			}),
		]);
		expect(contents.map((content) => content.type)).toEqual(
			supportsReasoning
				? [ModelSelectorContent, ThinkingLevelContent]
				: [ModelSelectorContent],
		);
		expect(onModelChange).toHaveResolvedWith({
			modelId: MODEL_ID,
			thinking: supportsReasoning,
			reasoningEffort: supportsReasoning ? "medium" : undefined,
		});
	});

	it("limits suggestions to discovered IDs and reuses the catalog without mutation", async () => {
		const model: Llms.ModelInfo = {
			id: MODEL_ID,
			name: "Fixture Reasoner",
			capabilities: ["reasoning"],
		};
		Object.freeze(model.capabilities);
		Object.freeze(model);
		const knownModels = Object.freeze({
			[MODEL_ID]: model,
			"undiscovered-model": Object.freeze({
				id: "undiscovered-model",
				name: "Undiscovered Model",
			}),
		});
		const original = structuredClone(knownModels);
		const { contents, config, openModelSelector } = setup(knownModels, [
			MODEL_ID,
			"medium",
			MODEL_ID,
			"medium",
		]);

		await openModelSelector();
		await openModelSelector();

		for (const content of [contents[0], contents[2]]) {
			expect(content?.props.models).toEqual([
				expect.objectContaining({ key: MODEL_ID, supportsReasoning: true }),
			]);
		}
		expect(config.knownModels).toBe(knownModels);
		expect(knownModels).toEqual(original);
	});

	it.each([
		{
			name: "an empty list",
			fetchModels: async () => Response.json({ data: [] }),
		},
		{
			name: "an unsuccessful response",
			fetchModels: async () => new Response(null, { status: 503 }),
		},
		{
			name: "a network failure",
			fetchModels: async () => {
				throw new Error("Fixture network failure");
			},
		},
	])("uses manual model entry after $name", async ({ fetchModels }) => {
		vi.mocked(fetch).mockImplementation(fetchModels);
		const { contents, onModelChange, openModelSelector } = setup(
			{ [MODEL_ID]: { id: MODEL_ID, capabilities: ["reasoning"] } },
			["manual-model"],
		);

		await openModelSelector();

		expect(contents.map((content) => content.type)).toEqual([
			ModelIdInputContent,
		]);
		expect(onModelChange).toHaveResolvedWith({
			modelId: "manual-model",
			thinking: false,
			reasoningEffort: undefined,
		});
	});

	it("cancels model selection without applying a model or clearing reasoning", async () => {
		const { config, onModelChange, openModelSelector, refocusTextarea } = setup(
			{ [MODEL_ID]: { id: MODEL_ID, capabilities: ["reasoning"] } },
			[undefined],
		);
		const onCancel = vi.fn();

		await openModelSelector({ onCancel });

		expect(onModelChange).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledOnce();
		expect(refocusTextarea).not.toHaveBeenCalled();
		expect(config).toMatchObject({
			modelId: MODEL_ID,
			thinking: true,
			reasoningEffort: "medium",
		});
	});

	it("returns to model selection when effort selection is canceled", async () => {
		const {
			config,
			contents,
			onModelChange,
			openModelSelector,
			refocusTextarea,
		} = setup({ [MODEL_ID]: { id: MODEL_ID, capabilities: ["reasoning"] } }, [
			MODEL_ID,
			undefined,
			undefined,
		]);

		await openModelSelector();

		expect(contents.map((content) => content.type)).toEqual([
			ModelSelectorContent,
			ThinkingLevelContent,
			ModelSelectorContent,
		]);
		expect(onModelChange).not.toHaveBeenCalled();
		expect(refocusTextarea).toHaveBeenCalledOnce();
		expect(config).toMatchObject({ thinking: true, reasoningEffort: "medium" });
	});
});
