import type { HubCommandName } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DriveAgentHomeWebviewFrame = {
	type: "drive_agent_home_get";
	workspaceRoot: string;
	slug: string;
	requestId?: string;
	[key: string]: unknown;
};

type SanitizedHome = {
	slug: string;
	agent: {
		name: string;
		description: string;
		tools?: string[];
		skills?: string[];
		editable?: boolean;
	};
	permissions: {
		presetIntent: "readonly" | "standard" | "full";
		approvalHooks: string[];
		notes?: string;
	};
};

type SanitizedCompiled = {
	name: string;
	slug: string;
	description: string;
	tools?: string[];
	skills?: string[];
};

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const items = value.filter(
		(entry): entry is string => typeof entry === "string" && entry.length > 0,
	);
	return items.length > 0 ? items : undefined;
}

function sanitizeHome(value: unknown): SanitizedHome | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const slug = typeof record.slug === "string" ? record.slug.trim() : "";
	const agentRaw =
		record.agent && typeof record.agent === "object"
			? (record.agent as Record<string, unknown>)
			: null;
	const permissionsRaw =
		record.permissions && typeof record.permissions === "object"
			? (record.permissions as Record<string, unknown>)
			: null;
	if (!slug || !agentRaw || !permissionsRaw) {
		return undefined;
	}
	const name = typeof agentRaw.name === "string" ? agentRaw.name.trim() : "";
	const description =
		typeof agentRaw.description === "string"
			? agentRaw.description.trim()
			: "";
	const presetIntent = permissionsRaw.presetIntent;
	if (
		!name ||
		!description ||
		(presetIntent !== "readonly" &&
			presetIntent !== "standard" &&
			presetIntent !== "full")
	) {
		return undefined;
	}
	const approvalHooks = Array.isArray(permissionsRaw.approvalHooks)
		? permissionsRaw.approvalHooks.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.length > 0,
			)
		: [];
	const notes =
		typeof permissionsRaw.notes === "string" ? permissionsRaw.notes : undefined;
	const tools = asStringArray(agentRaw.tools);
	const skills = asStringArray(agentRaw.skills);
	const editable =
		typeof agentRaw.editable === "boolean" ? agentRaw.editable : undefined;

	return {
		slug,
		agent: {
			name,
			description,
			...(tools ? { tools } : {}),
			...(skills ? { skills } : {}),
			...(editable !== undefined ? { editable } : {}),
		},
		permissions: {
			presetIntent,
			approvalHooks,
			...(notes !== undefined ? { notes } : {}),
		},
	};
}

function sanitizeCompiled(value: unknown): SanitizedCompiled | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const slug = typeof record.slug === "string" ? record.slug.trim() : "";
	const description =
		typeof record.description === "string" ? record.description.trim() : "";
	if (!name || !slug || !description) {
		return undefined;
	}
	const tools = asStringArray(record.tools);
	const skills = asStringArray(record.skills);
	return {
		name,
		slug,
		description,
		...(tools ? { tools } : {}),
		...(skills ? { skills } : {}),
	};
}

/**
 * Bridges Chat Drive Profile sheet to hub `drive_agent_home_get`.
 * Strips prompt fields before sending to the browser (DRV-PRIVACY / SoT).
 */
export async function handleDriveAgentHomeWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveAgentHomeWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "drive_agent_home_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
			requestId,
		});
		return;
	}

	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	const slug = typeof frame.slug === "string" ? frame.slug.trim() : "";
	if (!workspaceRoot) {
		ctx.send(peer, {
			type: "drive_agent_home_error",
			text: "workspaceRoot is required.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}
	if (!slug) {
		ctx.send(peer, {
			type: "drive_agent_home_error",
			text: "slug is required.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	const command = "drive_agent_home_get" as HubCommandName;
	try {
		const reply = await ctx.uiClient.command(command, { workspaceRoot, slug });
		if (!reply.ok) {
			ctx.send(peer, {
				type: "drive_agent_home_error",
				text: reply.error?.message ?? "Drive agent home command failed.",
				code: reply.error?.code,
				requestId,
			});
			return;
		}
		const home = sanitizeHome(reply.payload?.home);
		const compiled = sanitizeCompiled(reply.payload?.compiled);
		if (!home || !compiled) {
			ctx.send(peer, {
				type: "drive_agent_home_error",
				text: "Drive agent home reply missing home/compiled.",
				code: "invalid_reply",
				requestId,
			});
			return;
		}
		ctx.send(peer, {
			type: "drive_agent_home",
			home,
			compiled,
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_agent_home_error",
			text: error instanceof Error ? error.message : String(error),
			code: "drive_agent_home_command_failed",
			requestId,
		});
	}
}
