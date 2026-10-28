import { act, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
import {
	buildModelSections,
	MODEL_UNAVAILABLE_MESSAGE,
	ModelControl,
	ModelPill,
	ModelSheet,
} from "./ModelControl";

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
		expect(row?.props.accessibilityHint).toBe(`Model ID: ${id}`);
		expect(containsText(root, `Model ID: ${id}`)).toBe(true);
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
