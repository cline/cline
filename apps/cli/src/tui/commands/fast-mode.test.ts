import { describe, expect, it, vi } from "vitest";
import {
	canUseFastMode,
	enterFastMode,
	exitFastMode,
	FAST_MODE_MODEL_ID,
	type FastModeConfig,
	type FastModeNotice,
	type FastModeRestoreState,
	isFastModeActive,
} from "./fast-mode";

function makeConfig(overrides: Partial<FastModeConfig> = {}): FastModeConfig {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-5",
		thinking: true,
		reasoningEffort: "high",
		...overrides,
	};
}

function makeHarness() {
	const notices: FastModeNotice[] = [];
	let restoreState: FastModeRestoreState | null = null;
	return {
		notices,
		getRestoreState: () => restoreState,
		notify: (notice: FastModeNotice) => {
			notices.push(notice);
		},
		setRestoreState: (state: FastModeRestoreState | null) => {
			restoreState = state;
		},
	};
}

describe("fast mode predicates", () => {
	it("is reserved for the Cline usage-based billing provider", () => {
		expect(canUseFastMode("cline")).toBe(true);
		expect(canUseFastMode("cline-pass")).toBe(false);
		expect(canUseFastMode("anthropic")).toBe(false);
	});

	it("is active only when the fast model runs on the cline provider", () => {
		expect(
			isFastModeActive({ providerId: "cline", modelId: FAST_MODE_MODEL_ID }),
		).toBe(true);
		expect(
			isFastModeActive({
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-5",
			}),
		).toBe(false);
		expect(
			isFastModeActive({
				providerId: "openrouter",
				modelId: FAST_MODE_MODEL_ID,
			}),
		).toBe(false);
	});
});

describe("enterFastMode", () => {
	it("switches to the fast model and remembers the previous model", async () => {
		const config = makeConfig();
		const harness = makeHarness();
		const applyModelChange = vi.fn(async () => {});

		await enterFastMode({ config, applyModelChange, ...harness });

		expect(applyModelChange).toHaveBeenCalledOnce();
		expect(config.modelId).toBe(FAST_MODE_MODEL_ID);
		expect(harness.getRestoreState()).toEqual({
			modelId: "anthropic/claude-sonnet-5",
			thinking: true,
			reasoningEffort: "high",
		});
		expect(harness.notices).toEqual([
			{
				kind: "status",
				text: "Switched to Claude Opus 5 (Fast). Use /unfast to go back to anthropic/claude-sonnet-5.",
			},
		]);
	});

	it("refuses providers that are not Cline usage-based billing", async () => {
		const config = makeConfig({ providerId: "cline-pass" });
		const harness = makeHarness();
		const applyModelChange = vi.fn(async () => {});

		await enterFastMode({ config, applyModelChange, ...harness });

		expect(applyModelChange).not.toHaveBeenCalled();
		expect(config.modelId).toBe("anthropic/claude-sonnet-5");
		expect(harness.notices[0]?.kind).toBe("status");
		expect(harness.notices[0]?.text).toContain("usage-based billing");
	});

	it("does nothing when fast mode is already active", async () => {
		const config = makeConfig({ modelId: FAST_MODE_MODEL_ID });
		const harness = makeHarness();
		const applyModelChange = vi.fn(async () => {});

		await enterFastMode({ config, applyModelChange, ...harness });

		expect(applyModelChange).not.toHaveBeenCalled();
		expect(harness.notices[0]?.text).toContain("Already using");
	});

	it("rolls the config back when applying the model change fails", async () => {
		const config = makeConfig();
		const harness = makeHarness();
		const applyModelChange = vi.fn(async () => {
			throw new Error("restart failed");
		});

		await enterFastMode({ config, applyModelChange, ...harness });

		expect(config.modelId).toBe("anthropic/claude-sonnet-5");
		expect(config.thinking).toBe(true);
		expect(config.reasoningEffort).toBe("high");
		expect(harness.getRestoreState()).toBeNull();
		expect(harness.notices).toEqual([
			{
				kind: "error",
				text: "Could not switch to Claude Opus 5 (Fast): restart failed",
			},
		]);
	});
});

describe("exitFastMode", () => {
	it("restores the model that was active before /fast", async () => {
		const config = makeConfig({
			modelId: FAST_MODE_MODEL_ID,
			thinking: true,
			reasoningEffort: "high",
		});
		const harness = makeHarness();
		harness.setRestoreState({
			modelId: "anthropic/claude-sonnet-5",
			thinking: false,
			reasoningEffort: undefined,
		});
		const applyModelChange = vi.fn(async () => {});
		const openModelSelector = vi.fn(async () => {});

		await exitFastMode({
			config,
			restoreState: harness.getRestoreState(),
			applyModelChange,
			openModelSelector,
			...harness,
		});

		expect(applyModelChange).toHaveBeenCalledOnce();
		expect(openModelSelector).not.toHaveBeenCalled();
		expect(config.modelId).toBe("anthropic/claude-sonnet-5");
		expect(config.thinking).toBe(false);
		expect(config.reasoningEffort).toBeUndefined();
		expect(harness.getRestoreState()).toBeNull();
		expect(harness.notices).toEqual([
			{
				kind: "status",
				text: "Switched back to anthropic/claude-sonnet-5.",
			},
		]);
	});

	it("reports when fast mode is not active", async () => {
		const config = makeConfig();
		const harness = makeHarness();
		const applyModelChange = vi.fn(async () => {});
		const openModelSelector = vi.fn(async () => {});

		await exitFastMode({
			config,
			restoreState: null,
			applyModelChange,
			openModelSelector,
			...harness,
		});

		expect(applyModelChange).not.toHaveBeenCalled();
		expect(harness.notices[0]?.text).toContain("Fast mode is not active");
	});

	it("falls back to the model picker when no previous model was recorded", async () => {
		const config = makeConfig({ modelId: FAST_MODE_MODEL_ID });
		const harness = makeHarness();
		const applyModelChange = vi.fn(async () => {});
		const openModelSelector = vi.fn(async () => {});

		await exitFastMode({
			config,
			restoreState: null,
			applyModelChange,
			openModelSelector,
			...harness,
		});

		expect(applyModelChange).not.toHaveBeenCalled();
		expect(openModelSelector).toHaveBeenCalledOnce();
		expect(config.modelId).toBe(FAST_MODE_MODEL_ID);
	});

	it("stays in fast mode when applying the restore fails", async () => {
		const config = makeConfig({ modelId: FAST_MODE_MODEL_ID });
		const harness = makeHarness();
		harness.setRestoreState({
			modelId: "anthropic/claude-sonnet-5",
			thinking: true,
			reasoningEffort: "high",
		});
		const applyModelChange = vi.fn(async () => {
			throw new Error("restart failed");
		});
		const openModelSelector = vi.fn(async () => {});

		await exitFastMode({
			config,
			restoreState: harness.getRestoreState(),
			applyModelChange,
			openModelSelector,
			...harness,
		});

		expect(config.modelId).toBe(FAST_MODE_MODEL_ID);
		expect(harness.getRestoreState()).toEqual({
			modelId: "anthropic/claude-sonnet-5",
			thinking: true,
			reasoningEffort: "high",
		});
		expect(harness.notices).toEqual([
			{
				kind: "error",
				text: "Could not switch back to anthropic/claude-sonnet-5: restart failed",
			},
		]);
	});
});
