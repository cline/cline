import type { ClientContext } from "@cline/shared";
import {
	SessionSource,
	type SessionSource as SessionSourceValue,
} from "../types/common";

const SESSION_HISTORY_ORIGIN_METADATA_KEY = "sessionHistoryOrigin";

export interface SessionHistoryOriginMetadata {
	mode: string;
	version?: string;
	/**
	 * The trigger that initiated the session, when it is not a direct user
	 * action. E.g., the `source` label of the automation spec that started a
	 * scheduled run.
	 */
	trigger?: string;
}

function trimNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveClientSessionSource(
	client: ClientContext | undefined,
): SessionSourceValue | undefined {
	const identity = [client?.name, client?.platform]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
	if (!identity) return undefined;
	if (identity.includes("vscode") || identity.includes("visual studio code")) {
		return SessionSource.VSCODE;
	}
	if (
		identity.includes("jetbrains") ||
		identity.includes("webstorm") ||
		identity.includes("intellij") ||
		identity.includes("pycharm") ||
		identity.includes("goland") ||
		identity.includes("clion") ||
		identity.includes("rider") ||
		identity.includes("android studio")
	) {
		return SessionSource.JETBRAINS;
	}
	if (identity.includes("neovim")) return SessionSource.NEOVIM;
	if (identity.includes("kanban")) return SessionSource.KANBAN;
	if (identity.includes("desktop")) return SessionSource.DESKTOP;
	if (identity.includes("cline-platform")) {
		return SessionSource.WEB;
	}
	if (identity.includes("cline-cli") || identity.includes("cline-acp")) {
		return SessionSource.CLI;
	}
	if (identity.includes("cline-sdk") || identity.includes("cline-core")) {
		return SessionSource.CORE;
	}
	return undefined;
}

export function readSessionHistoryOriginMetadata(
	metadata: Record<string, unknown> | null | undefined,
): SessionHistoryOriginMetadata | undefined {
	const value = metadata?.[SESSION_HISTORY_ORIGIN_METADATA_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const mode = trimNonEmptyString(record.mode);
	if (!mode) {
		return undefined;
	}
	const version = trimNonEmptyString(record.version);
	const trigger = trimNonEmptyString(record.trigger);
	return {
		mode,
		...(version ? { version } : {}),
		...(trigger ? { trigger } : {}),
	};
}

export function withSessionHistoryOriginMetadata(
	metadata: Record<string, unknown> | null | undefined,
	origin: {
		mode?: string;
		version?: string;
		trigger?: string;
	},
): Record<string, unknown> {
	const existing = readSessionHistoryOriginMetadata(metadata);
	const mode = trimNonEmptyString(origin.mode) ?? existing?.mode ?? "user";
	const version = trimNonEmptyString(origin.version) ?? existing?.version;
	const trigger = trimNonEmptyString(origin.trigger) ?? existing?.trigger;
	return {
		...(metadata ?? {}),
		[SESSION_HISTORY_ORIGIN_METADATA_KEY]: {
			mode,
			...(version ? { version } : {}),
			...(trigger ? { trigger } : {}),
		},
	};
}
