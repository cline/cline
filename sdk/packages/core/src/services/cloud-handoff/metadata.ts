import type { CloudHandoffFingerprint, CloudHandoffMetadata } from "./types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function readRequiredString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function readWorkspaceRelativePath(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createCloudHandoffFingerprint(input: {
	repoUrl: string;
	branch: string;
	headSha: string;
	modelId: string;
	organizationId?: string;
	workspaceRelativePath?: string;
	mode?: "plan" | "yolo" | "zen";
}): CloudHandoffFingerprint {
	const repoUrl = readRequiredString(input.repoUrl);
	const branch = readRequiredString(input.branch);
	const headSha = readRequiredString(input.headSha);
	const modelId = readRequiredString(input.modelId);
	if (!repoUrl || !branch || !headSha || !modelId) {
		throw new Error("Cloud handoff fingerprint fields cannot be empty.");
	}
	const organizationId = readRequiredString(input.organizationId);
	const workspaceRelativePath = readWorkspaceRelativePath(
		input.workspaceRelativePath,
	);
	const mode = input.mode;
	return {
		repoUrl,
		branch,
		headSha,
		modelId,
		...(organizationId ? { organizationId } : {}),
		...(workspaceRelativePath ? { workspaceRelativePath } : {}),
		...(mode ? { mode } : {}),
	};
}

export function cloudHandoffFingerprintsEqual(
	left: CloudHandoffFingerprint | undefined,
	right: CloudHandoffFingerprint | undefined,
): boolean {
	return (
		left !== undefined &&
		right !== undefined &&
		left.repoUrl === right.repoUrl &&
		left.branch === right.branch &&
		left.headSha.toLowerCase() === right.headSha.toLowerCase() &&
		left.modelId === right.modelId &&
		left.organizationId === right.organizationId &&
		left.workspaceRelativePath === right.workspaceRelativePath &&
		left.mode === right.mode
	);
}

function readCloudHandoffFingerprint(
	value: unknown,
): CloudHandoffFingerprint | undefined {
	const fingerprint = asRecord(value);
	if (
		!fingerprint ||
		typeof fingerprint.repoUrl !== "string" ||
		typeof fingerprint.branch !== "string" ||
		typeof fingerprint.headSha !== "string" ||
		typeof fingerprint.modelId !== "string"
	) {
		return undefined;
	}
	try {
		return createCloudHandoffFingerprint({
			repoUrl: fingerprint.repoUrl,
			branch: fingerprint.branch,
			headSha: fingerprint.headSha,
			modelId: fingerprint.modelId,
			...(typeof fingerprint.organizationId === "string"
				? { organizationId: fingerprint.organizationId }
				: {}),
			...(typeof fingerprint.workspaceRelativePath === "string"
				? { workspaceRelativePath: fingerprint.workspaceRelativePath }
				: {}),
			...(fingerprint.mode === "plan" ||
			fingerprint.mode === "yolo" ||
			fingerprint.mode === "zen"
				? { mode: fingerprint.mode }
				: {}),
		});
	} catch {
		return undefined;
	}
}

export function readCloudHandoffMetadata(
	metadata: unknown,
): CloudHandoffMetadata | undefined {
	const value = asRecord(asRecord(metadata)?.handoff);
	if (!value) return undefined;
	const toCloudSessionId = readRequiredString(value.toCloudSessionId);
	const handedOffAt = readRequiredString(value.handedOffAt);
	const status = value.status;
	if (
		!toCloudSessionId ||
		!handedOffAt ||
		(status !== "pending" && status !== "complete")
	) {
		return undefined;
	}

	const innerSessionId = readRequiredString(value.innerSessionId);
	const dashboardUrl = readRequiredString(value.dashboardUrl);
	const fingerprint = readCloudHandoffFingerprint(value.fingerprint);
	return {
		toCloudSessionId,
		handedOffAt,
		status,
		...(innerSessionId ? { innerSessionId } : {}),
		...(dashboardUrl ? { dashboardUrl } : {}),
		...(fingerprint ? { fingerprint } : {}),
	};
}

export function mergeCloudHandoffMetadata(
	metadata: Record<string, unknown> | null | undefined,
	handoff: CloudHandoffMetadata,
): Record<string, unknown> {
	return { ...(metadata ?? {}), handoff };
}

export function clearCloudHandoffMetadata(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
	const { handoff: _handoff, ...rest } = metadata ?? {};
	return rest;
}

export function buildCloudHandoffDashboardUrl(
	appBaseUrl: string,
	outerSessionId: string,
): string {
	const sessionId = outerSessionId.trim();
	if (!sessionId) throw new Error("Cloud session id cannot be empty.");
	const url = new URL("/agents", appBaseUrl);
	url.searchParams.set("sessionId", sessionId);
	return url.toString();
}
