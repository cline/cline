import { createHash } from "node:crypto";
import type {
	BotToolConfiguration,
	EffectiveToolPreview,
	RunExecutionSnapshot,
	ToolAssignmentRule,
	ToolConfiguration,
	ToolDescriptor,
	ToolId,
	ToolProfile,
	ToolResolution,
} from "@cline/shared/gateway";
import type { ToolCatalogSnapshot } from "./catalog";
import { DEFAULT_TOOL_PROFILES, expandProfiles } from "./profiles";

export interface ToolResolutionInput {
	providerId: string;
	modelId: string;
	modelCapabilities?: readonly string[];
	modelManifestRevision?: string;
	role: "lead" | "worker" | "contractor";
	global?: BotToolConfiguration;
	workspace?: BotToolConfiguration;
	bot?: BotToolConfiguration;
	turn?: BotToolConfiguration;
	profiles?: readonly ToolProfile[];
	strictToolCalling?: boolean;
	now?: number;
}

interface EffectiveSelection {
	profiles: string[];
	tools: Map<string, ToolConfiguration>;
	rules: ToolAssignmentRule[];
}

function glob(pattern: string, value: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replaceAll("*", ".*");
	return new RegExp(`^${escaped}$`).test(value);
}

function selectorMatches(
	selector:
		| ToolAssignmentRule["when"]
		| ToolDescriptor["providerCompatibility"],
	input: ToolResolutionInput,
): boolean {
	if (!selector) return true;
	if (selector.providers && !selector.providers.includes(input.providerId))
		return false;
	if (selector.models && !selector.models.includes(input.modelId)) return false;
	if (
		selector.modelPatterns &&
		!selector.modelPatterns.some((p) => glob(p, input.modelId))
	)
		return false;
	if (
		selector.capabilities &&
		!selector.capabilities.every((c) => input.modelCapabilities?.includes(c))
	)
		return false;
	if (selector.excludeProviders?.includes(input.providerId)) return false;
	if (selector.excludeModels?.includes(input.modelId)) return false;
	return true;
}

function effectiveSelection(input: ToolResolutionInput): EffectiveSelection {
	const selection: EffectiveSelection = {
		profiles: [input.role],
		tools: new Map(),
		rules: [],
	};
	for (const layer of [input.global, input.workspace, input.bot, input.turn]) {
		if (!layer) continue;
		if (layer.profiles) selection.profiles = [...layer.profiles];
		for (const [id, config] of Object.entries(layer.tools ?? {})) {
			selection.tools.set(id, { ...selection.tools.get(id), ...config });
		}
		selection.rules.push(...(layer.assignments ?? []));
	}
	return selection;
}

export function previewTools(
	catalog: ToolCatalogSnapshot,
	input: ToolResolutionInput,
): EffectiveToolPreview & { profileRevisions: Record<string, number> } {
	const selection = effectiveSelection(input);
	const profiles = input.profiles ?? DEFAULT_TOOL_PROFILES;
	const expanded = expandProfiles(selection.profiles, profiles);
	const enabled = new Set([...expanded.required, ...expanded.optional]);
	const denied = new Set<string>();
	for (const rule of selection.rules) {
		if (!selectorMatches(rule.when, input)) continue;
		if (rule.useProfiles?.length) {
			const addition = expandProfiles(rule.useProfiles, profiles);
			for (const id of addition.required) expanded.required.add(id);
			for (const id of addition.optional) expanded.optional.add(id);
			Object.assign(expanded.revisions, addition.revisions);
			for (const id of [...addition.required, ...addition.optional])
				enabled.add(id);
		}
		for (const id of rule.enable ?? []) enabled.add(id);
		for (const id of rule.disable ?? []) enabled.delete(id);
		for (const id of rule.deny ?? []) {
			denied.add(id);
			enabled.delete(id);
		}
	}
	for (const [id, config] of selection.tools) {
		if (config.enabled === true) enabled.add(id);
		if (config.enabled === false) enabled.delete(id);
	}

	const resolutions: ToolResolution[] = [];
	const byId = new Map(
		catalog.entries.map((entry) => [entry.descriptor.id, entry]),
	);
	const allIds = new Set([...byId.keys(), ...enabled, ...denied]);
	for (const id of [...allIds].sort()) {
		const entry = byId.get(id as ToolId);
		const required = expanded.required.has(id);
		let status: ToolResolution["status"] = "enabled";
		let reason = "Selected by effective configuration";
		let source = "profile/configuration";
		if (denied.has(id)) {
			status = "denied";
			reason = "Denied by an assignment policy";
			source = "assignment";
		} else if (!enabled.has(id)) {
			status = "disabled";
			reason = "Not selected by the effective profiles and configuration";
		} else if (!entry) {
			status = required ? "required_missing" : "unavailable";
			reason = "No descriptor is registered";
			source = "catalog";
		} else if (
			!selectorMatches(entry.descriptor.providerCompatibility, input)
		) {
			status = required ? "required_missing" : "incompatible";
			reason = `Incompatible with ${input.providerId}/${input.modelId}`;
			source = "compatibility";
		} else if (!entry.available) {
			status = required ? "required_missing" : "unavailable";
			reason = `Executor ${entry.executorId} is unavailable`;
			source = "executor";
		} else if (
			entry.descriptor.strict === "required" &&
			!input.strictToolCalling
		) {
			status = required ? "required_missing" : "incompatible";
			reason = "Tool requires strict tool calling";
			source = "model-manifest";
		}
		resolutions.push({
			toolId: id as ToolId,
			status,
			required,
			reason,
			source,
		});
	}
	return {
		providerId: input.providerId,
		modelId: input.modelId,
		modelCapabilities: input.modelCapabilities ?? [],
		resolutions,
		canStartRun: !resolutions.some(
			(item) => expanded.required.has(item.toolId) && item.status !== "enabled",
		),
		profileRevisions: expanded.revisions,
	};
}

export function resolveToolSnapshot(
	catalog: ToolCatalogSnapshot,
	input: ToolResolutionInput,
): RunExecutionSnapshot {
	const preview = previewTools(catalog, input);
	if (!preview.canStartRun) {
		const missing = preview.resolutions
			.filter((item) => item.required && item.status !== "enabled")
			.map((item) => item.toolId);
		throw new Error(`Required tools unavailable: ${missing.join(", ")}`);
	}
	const configuration = effectiveSelection(input).tools;
	const entries = new Map(
		catalog.entries.map((entry) => [entry.descriptor.id, entry]),
	);
	const tools = preview.resolutions
		.filter((item) => item.status === "enabled")
		.map((item) => {
			const entry = entries.get(item.toolId);
			if (!entry) throw new Error(`Catalog lost ${item.toolId}`);
			const config = configuration.get(item.toolId);
			return {
				id: item.toolId,
				version: entry.descriptor.version,
				modelFacingName: item.toolId
					.slice(item.toolId.indexOf(":") + 1)
					.replaceAll("/", "__"),
				configurationRevision: 0,
				executorId: entry.executorId,
				execution: entry.descriptor.execution,
				strictEnabled:
					entry.descriptor.strict !== "disabled" &&
					input.strictToolCalling === true,
				approval:
					config?.approval === "always"
						? { mode: "always" as const }
						: config?.approval === "never"
							? { mode: "never" as const }
							: entry.descriptor.approval,
				...(config?.configuration
					? { configuration: config.configuration }
					: {}),
			};
		});
	const policyBody = JSON.stringify(
		tools.map(({ id, version, executorId, approval }) => ({
			id,
			version,
			executorId,
			approval,
		})),
	);
	return {
		providerId: input.providerId,
		modelId: input.modelId,
		modelManifestRevision: input.modelManifestRevision ?? "unknown",
		catalogGeneration: catalog.generation,
		profileRevisions: preview.profileRevisions,
		tools,
		effectivePolicyHash: createHash("sha256").update(policyBody).digest("hex"),
		createdAt: input.now ?? Date.now(),
	};
}
