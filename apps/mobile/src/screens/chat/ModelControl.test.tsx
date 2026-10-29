import * as Native from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
import {
	buildModelSections,
	MODEL_UNAVAILABLE_MESSAGE,
	ModelControl,
	ModelPill,
	ModelSheet,
} from "./ModelControl";

afterEach(() => vi.restoreAllMocks());

async function openModelSheet(root: ReactTestInstance) {
	const sheet = root
		.findAll(
			(node) => typeof node.type === "string" && node.type === "BottomSheet",
		)
		.at(-1);
	await act(async () => {
		sheet?.props.onChange?.(0);
	});
}

const models = [
	{ id: "cline/default", name: "Cline default", tags: ["Default"] },
	{ id: "cline/fast", name: "Cline fast", tags: ["Fast"] },
] as const;

describe("buildModelSections", () => {
	it("opens secondary settings only after the model sheet has closed", async () => {
		let dismiss!: (then: () => void) => void;
		const next = vi.fn();
		const { root } = render(
			<ModelSheet
				canChange
				loadModels={async () => models}
				onChange={async () => {}}
				settings={(close) => {
					dismiss = close;
					return null;
				}}
			/>,
		);
		await openModelSheet(root);
		act(() => dismiss(next));
		expect(next).not.toHaveBeenCalled();
		const sheet = root
			.findAll(
				(node) => typeof node.type === "string" && node.type === "BottomSheet",
			)
			.at(-1)!;
		act(() => sheet.props.onChange(-1));
		expect(next).toHaveBeenCalledOnce();
		act(() => sheet.props.onChange(-1));
		expect(next).toHaveBeenCalledOnce();
	});

	it("uses the composer's catalog immediately and keeps it visible if refresh fails", async () => {
		let reject!: (error: Error) => void;
		const { root } = render(
			<ModelControl
				cloud
				canChange
				cachedModels={models}
				loadModels={() =>
					new Promise((_, fail) => {
						reject = fail;
					})
				}
				onChange={async () => {}}
			/>,
		);
		expect(findByLabel(root, "Use model Cline fast")).toBeDefined();
		await openModelSheet(root);
		expect(containsText(root, "Loading Cline models")).toBe(false);
		expect(findByLabel(root, "Use model Cline fast")).toBeDefined();
		await act(async () => reject(new Error("offline")));
		expect(findByLabel(root, "Use model Cline fast")).toBeDefined();
		expect(containsText(root, "Showing the last loaded list")).toBe(true);
	});
	it("keeps one scrollable viewport through loading, filtering, and provider navigation", async () => {
		let finish!: (value: typeof models) => void;
		const { root } = render(
			<ModelControl
				cloud
				canChange
				loadModels={() =>
					new Promise<typeof models>((resolve) => {
						finish = resolve;
					})
				}
				onChange={async () => {}}
			/>,
		);
		const assertStable = () => {
			const sheet = root.findAll((node) => node.type === "BottomSheet").at(-1)!;
			expect(sheet.props.enableDynamicSizing).toBe(false);
			expect(sheet.props.snapPoints).toEqual(["70%"]);
			expect(
				root.findAll((node) => node.type === "BottomSheetScrollView"),
			).toHaveLength(1);
		};
		assertStable();
		await openModelSheet(root);
		expect(containsText(root, "Loading Cline models")).toBe(true);
		assertStable();
		await act(async () => finish(models));
		assertStable();
		act(() =>
			findByLabel(root, "Search models")?.props.onChangeText(
				"no matching model",
			),
		);
		assertStable();
		act(() => findByLabel(root, "Choose provider")?.props.onPress());
		assertStable();
		expect(findByLabel(root, "Provider: ClinePass")).toBeDefined();
	});
	it("keeps Close and Search outside scrolling results and resets only on a new opening", async () => {
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				cloud
				canChange
				cachedModels={models}
				loadModels={async () => models}
				onChange={onChange}
			/>,
		);
		const scroll = root.findAll(
			(node) => node.type === "BottomSheetScrollView",
		)[0]!;
		const scrollTo = vi.fn();
		root.findAll(
			(node) => node.props.scrollViewRef,
		)[0]!.props.scrollViewRef.current = { scrollTo };
		await openModelSheet(root);
		expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
		expect(findByLabel(scroll, "Search models")).toBeUndefined();
		expect(findByLabel(scroll, "Close model picker")).toBeUndefined();
		const search = findByLabel(root, "Search models")!;
		expect(search.props.autoFocus).not.toBe(true);
		expect(search.props.disableFullscreenUI).toBe(true);
		act(() => search.props.onChangeText("no matching model"));
		expect(containsText(root, "No models match")).toBe(true);
		act(() => findByLabel(root, "Clear model search")?.props.onPress());
		expect(findByLabel(root, "Search models")).toBe(search);
		expect(search.props.value).toBe("");
		act(() => search.props.onChangeText("fast"));
		await openModelSheet(root);
		expect(scrollTo).toHaveBeenCalledTimes(4);
		expect(search.props.value).toBe("fast");
		act(() =>
			root
				.findAll((node) => node.type === "BottomSheet")
				.at(-1)!
				.props.onChange(-1),
		);
		await openModelSheet(root);
		expect(scrollTo).toHaveBeenCalledTimes(5);
		expect(search.props.value).toBe("");
		expect(onChange).not.toHaveBeenCalled();
	});
	it("preserves focused search and query through rotation while allowing more landscape space", async () => {
		let height = 874;
		vi.spyOn(Native, "useWindowDimensions").mockImplementation(() => ({
			width: height === 874 ? 402 : 874,
			height,
			scale: 3,
			fontScale: 1,
		}));
		const props = {
			cloud: true,
			canChange: true,
			cachedModels: models,
			loadModels: vi.fn(async () => models),
			onChange: vi.fn(async () => {}),
		};
		const { root, renderer } = render(<ModelControl {...props} />);
		await openModelSheet(root);
		const search = findByLabel(root, "Search models")!;
		act(() => {
			search.props.onChangeText("fast");
			search.props.onFocus();
		});
		height = 402;
		act(() => renderer.update(<ModelControl {...props} />));
		expect(findByLabel(root, "Search models")).toBe(search);
		expect(search.props.value).toBe("fast");
		expect(
			root.findAll((node) => node.type === "BottomSheet").at(-1)!.props
				.snapPoints,
		).toEqual(["95%"]);
		expect(props.loadModels).toHaveBeenCalledTimes(1);
	});

	it("lets short-screen search reveal matching results without changing the model and return to options", async () => {
		vi.spyOn(Native, "useWindowDimensions").mockReturnValue({
			width: 685,
			height: 320,
			scale: 2.625,
			fontScale: 1,
		});
		const dismiss = vi.spyOn(Native.Keyboard, "dismiss");
		const change = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				canChange
				providerId="cline"
				modelId="cline/default"
				cachedModels={models}
				loadModels={async () => models}
				onChange={change}
			/>,
		);
		await openModelSheet(root);
		const search = findByLabel(root, "Search models");
		if (!search) throw new Error("Search missing");
		act(() => {
			search.props.onFocus();
			search.props.onChangeText("fast");
		});
		act(() => findByLabel(root, "Show model results")?.props.onPress());
		expect(dismiss).toHaveBeenCalledOnce();
		act(() => search.props.onBlur());
		expect(search.props.value).toBe("fast");
		expect(findByLabel(root, "Use model Cline fast")).toBeDefined();
		expect(change).not.toHaveBeenCalled();
		act(() => findByLabel(root, "Show model settings")?.props.onPress());
		expect(findByLabel(root, "Search models")).toBe(search);
		expect(search.props.value).toBe("");
		expect(findByLabel(root, "Current model: Cline default")).toBeDefined();
	});

	it("opens the tapped section even when native animation retained the previous callback", async () => {
		const props = {
			cloud: true,
			canChange: true,
			loadModels: async () => models,
			onChange: async () => {},
		};
		const { root, renderer } = render(
			<ModelSheet {...props} initialSection="models" />,
		);
		const staleOpen = root
			.findAll((node) => node.type === "BottomSheet")
			.at(-1)!.props.onChange;
		act(() =>
			renderer.update(<ModelSheet {...props} initialSection="providers" />),
		);
		await act(async () => staleOpen(0));
		expect(findByLabel(root, "Provider: ClinePass")).toBeDefined();
		expect(findByLabel(root, "Search models")).toBeUndefined();
	});
	it("does not reload and unmount search when an open sheet changes size", async () => {
		const loadModels = vi.fn(async () => models);
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="cline/default"
				canChange
				loadModels={loadModels}
				onChange={async () => {}}
			/>,
		);
		await openModelSheet(root);
		expect(findByLabel(root, "Search models")?.type).toBe(
			"BottomSheetTextInput",
		);
		act(() => findByLabel(root, "Search models")?.props.onChangeText("fast"));
		await openModelSheet(root);
		expect(loadModels).toHaveBeenCalledTimes(1);
		expect(findByLabel(root, "Search models")?.props.value).toBe("fast");
		const sheet = root.findAll((node) => node.type === "BottomSheet").at(-1);
		act(() => sheet?.props.onChange(-1));
		await openModelSheet(root);
		expect(loadModels).toHaveBeenCalledTimes(2);
		expect(containsText(root, "Loading Cline models")).toBe(false);
	});
	it("matches desktop's Recommended, Free, Cline Pass, and All tiers", () => {
		const sections = buildModelSections("cline", [
			{
				id: "recommended",
				name: "Recommended",
				tags: ["BEST"],
				tier: "recommended",
			},
			{ id: "free", name: "Free", tags: [], tier: "free" },
			{ id: "pass", name: "Pass", tags: [], tier: "subscribed" },
			{ id: "other", name: "Other", tags: [] },
		]);
		expect(sections.map((section) => section.label)).toEqual([
			"Recommended",
			"Free",
			"Cline Pass",
			"All models",
		]);
	});

	it("keeps ordinary and local provider catalogs flat", () => {
		expect(buildModelSections("anthropic", models)).toEqual([
			{ id: "all", models },
		]);
	});
});

describe("ModelPill", () => {
	it("uses a readable primary name in both composer variants before catalog loading", () => {
		for (const compactLabel of [false, true]) {
			const { root } = render(
				<ModelPill
					cloud
					compactLabel={compactLabel}
					modelId="cline-new27-20261022-sonnet55-vertex-global-r1"
					onPress={vi.fn()}
				/>,
			);
			expect(findByLabel(root, "Model: Claude Sonnet 5.5")).toBeDefined();
		}
	});
	it("shows the actual provider and model and opens on press", () => {
		const onPress = vi.fn();
		const { root } = render(
			<ModelPill
				providerId="cline"
				modelId="cline/default"
				onPress={onPress}
			/>,
		);
		const pill = findByLabel(
			root,
			"Model: Cline Usage-Billing · Cline default",
		);
		expect(pill?.props.accessibilityRole).toBe("button");
		act(() => pill?.props.onPress());
		expect(onPress).toHaveBeenCalledOnce();
	});
});

describe("ModelControl", () => {
	it("shows friendly names but selects and searches exact technical routing IDs", async () => {
		const id = "cline-new27-20261022-sonnet55-vertex-global-r1";
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				cloud
				canChange
				cachedModels={[
					{
						id,
						name: "Claude Sonnet 5.5",
						tags: [],
						description: "Private deployment",
					},
				]}
				loadModels={async () => []}
				onChange={onChange}
			/>,
		);
		const row = findByLabel(root, "Use model Claude Sonnet 5.5");
		expect(containsText(root, `Model ID: ${id}`)).toBe(false);
		expect(containsText(root, "Private deployment")).toBe(false);
		act(() =>
			findByLabel(
				root,
				"Show model details: Claude Sonnet 5.5",
			)?.props.onPress(),
		);
		expect(containsText(root, `Model ID: ${id}`)).toBe(true);
		expect(containsText(root, "Private deployment")).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
		act(() =>
			findByLabel(root, "Search models")?.props.onChangeText(
				"vertex-global-r1",
			),
		);
		expect(findByLabel(root, "Use model Claude Sonnet 5.5")).toBeDefined();
		await act(async () => row?.props.onPress());
		expect(onChange).toHaveBeenCalledWith(id, expect.objectContaining({ id }));
	});
	it("Cloud separates three provider offers and applies only an explicitly chosen model", async () => {
		const choices = [
			{
				id: "anthropic/sonnet",
				name: "Sonnet",
				tags: [],
				catalogId: "cline" as const,
			},
			{
				id: "cline-pass/reasoner",
				name: "Pass model",
				tags: [],
				catalogId: "cline-pass" as const,
			},
			{
				id: "cline-cloud/fast",
				name: "Free model",
				tags: [],
				catalogId: "cline-cloud" as const,
			},
		];
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				cloud
				providerId="cline"
				modelId="cline-cloud/fast"
				canChange
				loadModels={async () => choices}
				onChange={onChange}
			/>,
		);
		await openModelSheet(root);
		expect(findByLabel(root, "Provider: ClineFree")).toBeDefined();
		expect(
			findByLabel(root, "Choose provider")?.props.accessibilityValue,
		).toEqual({
			text: "ClineFree",
		});
		expect(findByLabel(root, "Use model Free model")).toBeDefined();
		expect(findByLabel(root, "Use model Sonnet")).toBeUndefined();
		act(() => findByLabel(root, "Choose provider")?.props.onPress());
		for (const name of ["Cline Usage-Billing", "ClinePass", "ClineFree"])
			expect(findByLabel(root, `Provider: ${name}`)).toBeDefined();
		act(() =>
			findByLabel(root, "Provider: Cline Usage-Billing")?.props.onPress(),
		);
		expect(onChange).not.toHaveBeenCalled();
		expect(
			findByLabel(root, "Choose provider")?.props.accessibilityValue,
		).toEqual({
			text: "Cline Usage-Billing",
		});
		expect(findByLabel(root, "Use model Free model")).toBeUndefined();
		await act(async () =>
			findByLabel(root, "Use model Sonnet")?.props.onPress(),
		);
		expect(onChange).toHaveBeenCalledWith("anthropic/sonnet", choices[0]);
	});
	it("renders Cloud feed tiers and their badges", async () => {
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="recommended"
				canChange
				loadModels={async () => [
					{
						id: "recommended",
						name: "Recommended model",
						description: "Strong for coding",
						tags: ["BEST"],
						tier: "recommended",
					},
					{ id: "free", name: "Free model", tags: [], tier: "free" },
				]}
				onChange={async () => {}}
			/>,
		);
		await openModelSheet(root);
		expect(containsText(root, "Recommended")).toBe(true);
		expect(containsText(root, "Try with limited usage at no cost")).toBe(true);
		expect(containsText(root, "BEST")).toBe(true);
	});

	it("lets a local Cline session apply a catalog model", async () => {
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="cline/default"
				canChange
				loadModels={async () => models}
				onChange={onChange}
			/>,
		);
		await openModelSheet(root);
		await act(async () => {
			findByLabel(root, "Use model Cline fast")?.props.onPress();
		});
		expect(onChange).toHaveBeenCalledWith("cline/fast", models[1]);
	});

	it("distinguishes the same model on two providers and searches the full catalog", async () => {
		const choices = [
			{ id: "same", providerId: "alpha", name: "Shared model", tags: [] },
			{ id: "same", providerId: "beta", name: "Shared model", tags: [] },
		];
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				providerId="alpha"
				modelId="same"
				canChange
				loadModels={async () => choices}
				onChange={onChange}
			/>,
		);
		await openModelSheet(root);
		expect(
			findByLabel(root, "Use model Shared model from alpha")?.props
				.accessibilityState.checked,
		).toBe(true);
		expect(
			findByLabel(root, "Use model Shared model from beta")?.props
				.accessibilityState.checked,
		).toBe(false);
		act(() => findByLabel(root, "Search models")?.props.onChangeText("beta"));
		expect(
			findByLabel(root, "Use model Shared model from alpha"),
		).toBeUndefined();
		await act(async () =>
			findByLabel(root, "Use model Shared model from beta")?.props.onPress(),
		);
		expect(onChange).toHaveBeenCalledWith("same", choices[1]);
	});

	it("explains why an active Cloud model stays fixed", () => {
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="cline/default"
				canChange={false}
				lockedMessage={`${MODEL_UNAVAILABLE_MESSAGE} Start a new Cloud workspace to choose another model.`}
				loadModels={async () => models}
				onChange={async () => {}}
			/>,
		);
		expect(containsText(root, MODEL_UNAVAILABLE_MESSAGE)).toBe(true);
		expect(findByLabel(root, "Use model Cline fast")).toBeUndefined();
	});

	it("disables changes while Cline is running", async () => {
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="cline/default"
				canChange
				busy
				loadModels={async () => models}
				onChange={async () => {}}
			/>,
		);
		await openModelSheet(root);
		expect(
			findByLabel(root, "Use model Cline fast")?.props.accessibilityState
				.disabled,
		).toBe(true);
		expect(containsText(root, "Wait for the current turn")).toBe(true);
	});

	it("waits until the picker opens and lets a failed catalog retry", async () => {
		const loadModels = vi
			.fn<() => Promise<typeof models>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(models);
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="cline/default"
				canChange
				loadModels={loadModels}
				onChange={async () => {}}
			/>,
		);
		expect(loadModels).not.toHaveBeenCalled();
		await openModelSheet(root);
		expect(containsText(root, "offline")).toBe(true);
		await act(async () => {
			findByLabel(root, "Try again")?.props.onPress();
		});
		expect(loadModels).toHaveBeenCalledTimes(2);
		expect(findByLabel(root, "Use model Cline fast")).toBeDefined();
	});
});

it("hands off settings once when an opening model sheet closes with only onClose", async () => {
	let dismiss!: (then: () => void) => void;
	const next = vi.fn();
	const { root } = render(
		<ModelSheet
			canChange
			loadModels={async () => models}
			onChange={async () => {}}
			settings={(close) => {
				dismiss = close;
				return null;
			}}
		/>,
	);
	const sheet = root
		.findAll(
			(node) => typeof node.type === "string" && node.type === "BottomSheet",
		)
		.at(-1);
	act(() => sheet?.props.onAnimate(-1, 0));
	act(() => dismiss(next));
	expect(next).not.toHaveBeenCalled();
	// Gorhom finishes at the original current index (-1), so no onChange fires.
	act(() => sheet?.props.onClose?.());
	expect(next).toHaveBeenCalledOnce();
	await act(async () => sheet?.props.onChange(0));
	act(() => sheet?.props.onChange(-1));
	act(() => sheet?.props.onClose?.());
	expect(next).toHaveBeenCalledOnce();
});

it("does not repeat a normal settings handoff when onChange is followed by onClose", async () => {
	let dismiss!: (then: () => void) => void;
	const next = vi.fn(),
		fresh = vi.fn();
	const { root } = render(
		<ModelSheet
			canChange
			loadModels={async () => models}
			onChange={async () => {}}
			settings={(close) => {
				dismiss = close;
				return null;
			}}
		/>,
	);
	const sheet = root
		.findAll(
			(node) => typeof node.type === "string" && node.type === "BottomSheet",
		)
		.at(-1);
	await openModelSheet(root);
	act(() => dismiss(next));
	act(() => sheet?.props.onChange(-1));
	act(() => sheet?.props.onClose?.());
	expect(next).toHaveBeenCalledOnce();
	await openModelSheet(root);
	act(() => dismiss(fresh));
	act(() => sheet?.props.onChange(-1));
	act(() => sheet?.props.onClose?.());
	expect(fresh).toHaveBeenCalledOnce();
	expect(next).toHaveBeenCalledOnce();
	act(() => sheet?.props.onChange(-1));
	expect(fresh).toHaveBeenCalledOnce();
});

describe("phone model picker", () => {
	it("keeps the configured model and its details when refresh returns a partial catalog", async () => {
		const current = {
			id: "anthropic/sonnet-kept",
			name: "My Sonnet",
			tags: [],
			description: "Current private deployment",
		};
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				cloud
				providerId="cline"
				modelId={current.id}
				canChange
				cachedModels={[current]}
				loadModels={async () => [models[1]]}
				onChange={onChange}
			/>,
		);
		await openModelSheet(root);
		expect(findByLabel(root, "Current model: My Sonnet")).toBeDefined();
		expect(
			findByLabel(root, "Use model My Sonnet")?.props.accessibilityState
				.checked,
		).toBe(true);
		expect(containsText(root, current.description)).toBe(false);
		act(() => findByLabel(root, "Show current model details")?.props.onPress());
		expect(containsText(root, `Model ID: ${current.id}`)).toBe(true);
		expect(containsText(root, current.description)).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
	});

	it.each([
		{ canChange: false, busy: false },
		{ canChange: true, busy: true },
	])("keeps an unknown provider's current model visible during locked or busy states: %s", async ({
		canChange,
		busy,
	}) => {
		const onChange = vi.fn(async () => {});
		const { root } = render(
			<ModelControl
				providerId="private-provider"
				modelId="private/model-42"
				canChange={canChange}
				busy={busy}
				loadModels={async () => models}
				onChange={onChange}
			/>,
		);
		await openModelSheet(root);
		expect(findByLabel(root, "Current model: Model 42")).toBeDefined();
		expect(findByLabel(root, "Close model picker")).toBeDefined();
		act(() => findByLabel(root, "Show current model details")?.props.onPress());
		expect(containsText(root, "Model ID: private/model-42")).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("groups Cloud offers only within the browsed catalog and preserves the current summary while searching", async () => {
		const catalog = [
			{
				id: "current",
				name: "Current coding model",
				tags: [],
				catalogId: "cline" as const,
			},
			{
				id: "rec",
				name: "Recommended coding",
				tier: "recommended" as const,
				tags: ["BEST"],
				catalogId: "cline" as const,
				supportsImages: true,
				supportsReasoning: true,
			},
			{
				id: "free",
				name: "Free coding",
				tier: "free" as const,
				tags: [],
				catalogId: "cline" as const,
			},
			{
				id: "pass",
				name: "Other offer",
				tier: "subscribed" as const,
				tags: [],
				catalogId: "cline-pass" as const,
			},
		];
		const { root } = render(
			<ModelControl
				cloud
				providerId="cline"
				modelId="current"
				canChange
				loadModels={async () => catalog}
				onChange={async () => {}}
			/>,
		);
		await openModelSheet(root);
		expect(containsText(root, "Recommended")).toBe(true);
		expect(containsText(root, "Free")).toBe(true);
		expect(containsText(root, "Images · Thinking")).toBe(true);
		expect(findByLabel(root, "Use model Other offer")).toBeUndefined();
		act(() =>
			findByLabel(root, "Search models")?.props.onChangeText("does-not-exist"),
		);
		expect(
			findByLabel(root, "Current model: Current coding model"),
		).toBeDefined();
		expect(findByLabel(root, "Use model Current coding model")).toBeUndefined();
		expect(containsText(root, "No models match your search.")).toBe(true);
	});

	it("admits only one model update from two taps before React commits", async () => {
		let finish!: () => void;
		const onChange = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const { root } = render(
			<ModelControl
				providerId="cline"
				modelId="cline/default"
				canChange
				cachedModels={models}
				loadModels={async () => models}
				onChange={onChange}
			/>,
		);
		const press = findByLabel(root, "Use model Cline fast")?.props.onPress;
		act(() => {
			press();
			press();
		});
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(
			findByLabel(root, "Use model Cline fast")?.props.accessibilityState
				.disabled,
		).toBe(true);
		await act(async () => finish());
	});

	it("rejects a captured choice after the session becomes busy", () => {
		const onChange = vi.fn(async () => {});
		const props = {
			providerId: "cline",
			modelId: "cline/default",
			canChange: true,
			cachedModels: models,
			loadModels: async () => models,
			onChange,
		};
		const { root, renderer } = render(<ModelControl {...props} />);
		const stalePress = findByLabel(root, "Use model Cline fast")?.props.onPress;
		act(() => renderer.update(<ModelControl {...props} busy />));
		act(() => stalePress());
		expect(onChange).not.toHaveBeenCalled();
	});
});

it("keeps an absent current model in its known Cloud offer after a partial refresh", async () => {
	const current = {
		id: "managed/custom",
		name: "Managed model",
		catalogId: "cline-cloud" as const,
		tags: [],
	};
	const onChange = vi.fn(async () => {});
	const { root } = render(
		<ModelControl
			cloud
			providerId="cline"
			modelId={current.id}
			cachedModels={[current]}
			canChange
			loadModels={async () => [
				{
					id: "paid/other",
					name: "Paid other",
					catalogId: "cline" as const,
					tags: [],
				},
			]}
			onChange={onChange}
		/>,
	);
	await openModelSheet(root);
	expect(
		findByLabel(root, "Choose provider")?.props.accessibilityValue,
	).toEqual({ text: "ClineFree" });
	expect(
		findByLabel(root, "Use model Managed model")?.props.accessibilityState
			.checked,
	).toBe(true);
	expect(findByLabel(root, "Use model Paid other")).toBeUndefined();
	act(() => findByLabel(root, "Choose provider")?.props.onPress());
	expect(
		findByLabel(root, "Provider: ClineFree")?.props.accessibilityState,
	).toEqual({ checked: true, disabled: false });
	expect(onChange).not.toHaveBeenCalled();
});

it("keeps a failed model choice explicit and permits one deliberate retry", async () => {
	const onChange = vi
		.fn()
		.mockRejectedValueOnce(new Error("Model service unavailable"))
		.mockResolvedValueOnce(undefined);
	const { root } = render(
		<ModelControl
			providerId="cline"
			modelId="cline/default"
			cachedModels={models}
			canChange
			loadModels={async () => models}
			onChange={onChange}
		/>,
	);
	await act(async () =>
		findByLabel(root, "Use model Cline fast")?.props.onPress(),
	);
	expect(containsText(root, "Model service unavailable")).toBe(true);
	expect(
		findByLabel(root, "Use model Cline fast")?.props.accessibilityState
			.disabled,
	).toBe(false);
	expect(onChange).toHaveBeenCalledTimes(1);
	await act(async () =>
		findByLabel(root, "Use model Cline fast")?.props.onPress(),
	);
	expect(onChange).toHaveBeenCalledTimes(2);
	expect(containsText(root, "Model service unavailable")).toBe(false);
});
