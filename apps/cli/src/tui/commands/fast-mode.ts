import type { Config } from "../../utils/types";

/**
 * Fast mode is a shortcut for Cline usage-based billing accounts: /fast jumps
 * to the Opus 5 fast-mode model and /unfast returns to the model that was
 * active before. ClinePass (subscription) accounts are excluded because the
 * fast model is only served through usage-based billing.
 */
export const FAST_MODE_PROVIDER_ID = "cline";
export const FAST_MODE_MODEL_ID = "anthropic/claude-opus-5-fast";
export const FAST_MODE_MODEL_NAME = "Claude Opus 5 (Fast)";

export type FastModeConfig = Pick<
	Config,
	"providerId" | "modelId" | "thinking" | "reasoningEffort"
>;

export interface FastModeRestoreState {
	modelId: string;
	thinking?: Config["thinking"];
	reasoningEffort?: Config["reasoningEffort"];
}

export type FastModeNotice = { kind: "status" | "error"; text: string };

export function canUseFastMode(providerId: string): boolean {
	return providerId === FAST_MODE_PROVIDER_ID;
}

export function isFastModeActive(
	config: Pick<FastModeConfig, "providerId" | "modelId">,
): boolean {
	return (
		canUseFastMode(config.providerId) && config.modelId === FAST_MODE_MODEL_ID
	);
}

function snapshotModelState(config: FastModeConfig): FastModeRestoreState {
	return {
		modelId: config.modelId,
		thinking: config.thinking,
		reasoningEffort: config.reasoningEffort,
	};
}

function applyModelState(
	config: FastModeConfig,
	state: FastModeRestoreState,
): void {
	config.modelId = state.modelId;
	config.thinking = state.thinking;
	config.reasoningEffort = state.reasoningEffort;
}

export async function enterFastMode(input: {
	config: FastModeConfig;
	applyModelChange: () => Promise<void>;
	notify: (notice: FastModeNotice) => void;
	setRestoreState: (state: FastModeRestoreState | null) => void;
}): Promise<void> {
	const { config, applyModelChange, notify, setRestoreState } = input;
	if (!canUseFastMode(config.providerId)) {
		notify({
			kind: "status",
			text: "/fast is available with Cline usage-based billing. Use /model to switch providers.",
		});
		return;
	}
	if (isFastModeActive(config)) {
		notify({
			kind: "status",
			text: `Already using ${FAST_MODE_MODEL_NAME}. Use /unfast to switch back.`,
		});
		return;
	}
	const previous = snapshotModelState(config);
	config.modelId = FAST_MODE_MODEL_ID;
	try {
		await applyModelChange();
	} catch (error) {
		applyModelState(config, previous);
		notify({
			kind: "error",
			text: `Could not switch to ${FAST_MODE_MODEL_NAME}: ${error instanceof Error ? error.message : String(error)}`,
		});
		return;
	}
	setRestoreState(previous);
	notify({
		kind: "status",
		text: `Switched to ${FAST_MODE_MODEL_NAME}. Use /unfast to go back to ${previous.modelId}.`,
	});
}

export async function exitFastMode(input: {
	config: FastModeConfig;
	restoreState: FastModeRestoreState | null;
	applyModelChange: () => Promise<void>;
	notify: (notice: FastModeNotice) => void;
	setRestoreState: (state: FastModeRestoreState | null) => void;
	openModelSelector: () => Promise<void>;
}): Promise<void> {
	const {
		config,
		restoreState,
		applyModelChange,
		notify,
		setRestoreState,
		openModelSelector,
	} = input;
	if (!isFastModeActive(config)) {
		notify({
			kind: "status",
			text: `Fast mode is not active. Use /fast to switch to ${FAST_MODE_MODEL_NAME}.`,
		});
		return;
	}
	if (!restoreState || restoreState.modelId === FAST_MODE_MODEL_ID) {
		// Nothing recorded to go back to (e.g. the CLI started on the fast
		// model), so hand off to the regular model picker instead.
		await openModelSelector();
		return;
	}
	const active = snapshotModelState(config);
	applyModelState(config, restoreState);
	try {
		await applyModelChange();
	} catch (error) {
		applyModelState(config, active);
		notify({
			kind: "error",
			text: `Could not switch back to ${restoreState.modelId}: ${error instanceof Error ? error.message : String(error)}`,
		});
		return;
	}
	setRestoreState(null);
	notify({
		kind: "status",
		text: `Switched back to ${restoreState.modelId}.`,
	});
}
