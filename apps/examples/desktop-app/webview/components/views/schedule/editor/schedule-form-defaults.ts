import {
	CLINE_DEFAULT_MODEL_ID,
	isChatWorkspacePath,
} from "@cline/shared/browser";
import { desktopClient } from "@/lib/desktop-client";
import {
	type ModelSelectionStorage,
	readModelSelectionStorageFromWindow,
} from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";
import { loadProviderModelCatalog } from "@/lib/provider-model-catalog";
import { FALLBACK_PROVIDER_MODELS } from "@/lib/provider-model-defaults";
import {
	isAbsoluteFilePath,
	LOCAL_WORKSPACE_ENVIRONMENT_ID,
	normalizeWorkspacePath,
	readWorkspaceSelectionFromWindow,
} from "@/lib/workspace-paths";
import { asTrimmedFormString } from "../schedule-format";
import type { ScheduleTemplate } from "../schedule-templates";
import type { ProcessContext, ScheduleFormState } from "../schedule-types";
import { createDefaultScheduleForm } from "./schedule-form-model";

/** A folder a schedule can run in, or nothing: not a chat workspace or a drive root. */
function usableProjectFolder(path: unknown): string {
	const trimmed = asTrimmedFormString(path);
	const normalized = normalizeWorkspacePath(trimmed);
	if (
		!isAbsoluteFilePath(trimmed) ||
		isChatWorkspacePath(trimmed) ||
		normalized === "/" ||
		normalized === "\\" ||
		/^[a-z]:$/i.test(normalized)
	)
		return "";
	return trimmed;
}

/** The remembered provider and model where available, otherwise the first offered. */
function pickModelSelection(
	remembered: ModelSelectionStorage,
	providerModels: Record<string, string[]>,
	availableProviders = Object.keys(providerModels),
) {
	const rememberedProvider = normalizeProviderId(remembered.lastProvider);
	const provider =
		rememberedProvider && availableProviders.includes(rememberedProvider)
			? rememberedProvider
			: (availableProviders[0] ?? "cline");
	const models = providerModels[provider] ?? [];
	const rememberedModel =
		remembered.lastModelByProvider[provider] ??
		remembered.lastModelByProvider[remembered.lastProvider];
	const model =
		rememberedModel && models.includes(rememberedModel)
			? rememberedModel
			: (models[0] ?? CLINE_DEFAULT_MODEL_ID);
	return { provider, model };
}

/** What chat last used, read once so every default starts from the same choices. */
export function readRememberedChoices() {
	return {
		modelSelection: readModelSelectionStorageFromWindow(),
		projectFolder: usableProjectFolder(
			readWorkspaceSelectionFromWindow(LOCAL_WORKSPACE_ENVIRONMENT_ID)
				.lastWorkspace,
		),
	};
}

/** A new draft: the template's content, with the model and folder chat last used. */
export function newScheduleForm(
	template: ScheduleTemplate | undefined,
	remembered: ReturnType<typeof readRememberedChoices>,
): ScheduleFormState {
	return createDefaultScheduleForm({
		...(template
			? {
					name: template.name,
					description: template.description,
					scheduleType: template.scheduleType,
					scheduleHour: template.scheduleHour,
					scheduleMinute: template.scheduleMinute,
					scheduleDays: template.scheduleDays,
					prompt: template.prompt,
				}
			: undefined),
		...pickModelSelection(remembered.modelSelection, FALLBACK_PROVIDER_MODELS),
		workspaceRoot: remembered.projectFolder,
	});
}

/** The app's own folder, for a draft with no remembered one. Undefined if it cannot be read. */
export async function lookUpProjectFolder(): Promise<string | undefined> {
	try {
		const context = await desktopClient.invoke<ProcessContext>(
			"get_process_context",
			{ environmentId: LOCAL_WORKSPACE_ENVIRONMENT_ID },
		);
		return (
			usableProjectFolder(context.workspaceRoot) ||
			usableProjectFolder(context.cwd)
		);
	} catch {
		return undefined;
	}
}

/**
 * The remembered choice checked against the providers that are really set up.
 * Undefined if discovery fails or offers nothing, which keeps the fallback.
 */
export async function lookUpModelSelection(
	remembered: ModelSelectionStorage,
): Promise<{ provider: string; model: string } | undefined> {
	try {
		const catalog = await loadProviderModelCatalog();
		const candidates = new Set([
			...catalog.enabledProviderIds,
			"cline",
			...Object.keys(FALLBACK_PROVIDER_MODELS).filter(
				(provider) => provider in catalog.providerModels,
			),
		]);
		const providers = Array.from(candidates).filter(
			(provider) => (catalog.providerModels[provider]?.length ?? 0) > 0,
		);
		if (providers.length === 0) return undefined;
		return pickModelSelection(remembered, catalog.providerModels, providers);
	} catch {
		return undefined;
	}
}
