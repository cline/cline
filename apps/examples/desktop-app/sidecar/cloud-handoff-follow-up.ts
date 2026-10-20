import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
	CloudCreationOptions,
	CloudSendLifecycle,
} from "@cline/core/cloud";
import { resolveClineDataDir } from "@cline/shared/storage";
import { z } from "zod";

export type CloudHandoffFollowUp = {
	draftId: string;
	sourceSessionId: string;
	command: string;
	userImages: string[];
	unconfirmed?: boolean;
	initialTask?: CloudCreationOptions;
};

const initialTaskSchema: z.ZodType<CloudCreationOptions> = z
	.object({
		autoApproveTools: z.boolean().optional(),
		thinking: z.boolean().optional(),
		reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
		mode: z.enum(["act", "plan", "yolo", "zen"]).optional(),
		workspaceRelativePath: z.string().optional(),
	})
	.strict();

const activeRecoverySends = new Map<string, number>();

function followUpPath(targetSessionId: string): string {
	const key = createHash("sha256").update(targetSessionId).digest("hex");
	return join(
		resolveClineDataDir(),
		"desktop-handoff-follow-ups",
		`${key}.json`,
	);
}

export function saveCloudHandoffFollowUp(
	targetSessionId: string,
	followUp: Omit<CloudHandoffFollowUp, "draftId"> & { draftId?: string },
): void {
	const path = followUpPath(targetSessionId);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(
			temporaryPath,
			JSON.stringify({
				...followUp,
				draftId: followUp.draftId ?? randomUUID(),
			}),
			{ mode: 0o600 },
		);
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

export function readCloudHandoffFollowUp(
	targetSessionId: string,
): CloudHandoffFollowUp | null {
	let raw: string;
	try {
		raw = readFileSync(followUpPath(targetSessionId), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value = JSON.parse(raw) as CloudHandoffFollowUp;
	if (
		typeof value?.sourceSessionId !== "string" ||
		typeof value.command !== "string" ||
		!Array.isArray(value.userImages) ||
		!value.userImages.every((image) => typeof image === "string") ||
		typeof value.draftId !== "string" ||
		(value.unconfirmed !== undefined && typeof value.unconfirmed !== "boolean")
	) {
		throw new Error("The saved cloud follow-up could not be read.");
	}
	if (value.initialTask !== undefined)
		value.initialTask = initialTaskSchema.parse(value.initialTask);
	return value;
}

export function clearCloudHandoffFollowUp(targetSessionId: string): void {
	rmSync(followUpPath(targetSessionId), { force: true });
}

export function getRecoverableCloudHandoffFollowUp(
	targetSessionId: string,
): CloudHandoffFollowUp | null {
	return activeRecoverySends.has(targetSessionId)
		? null
		: readCloudHandoffFollowUp(targetSessionId);
}

export function updateCloudHandoffFollowUp(
	targetSessionId: string,
	expected: CloudHandoffFollowUp,
	action: "restore" | "dismiss",
): CloudHandoffFollowUp | null {
	if (activeRecoverySends.has(targetSessionId))
		throw new Error(
			"Wait for the follow-up send to finish before updating it.",
		);
	const saved = readCloudHandoffFollowUp(targetSessionId);
	if (!saved || !isDeepStrictEqual(saved, expected))
		throw new Error(
			"The saved follow-up changed. Reopen the cloud session to check it.",
		);
	if (action === "dismiss") {
		clearCloudHandoffFollowUp(targetSessionId);
		return null;
	}
	const { unconfirmed: _, ...restored } = saved;
	saveCloudHandoffFollowUp(targetSessionId, restored);
	return restored;
}

export async function sendWithCloudHandoffFollowUp<
	T extends { ok: true; recoveredAfterDisconnect?: boolean },
>(
	targetSessionId: string,
	command: string,
	userImages: string[],
	send: (lifecycle?: CloudSendLifecycle) => Promise<T>,
	draftId?: string,
): Promise<T> {
	const saved = readCloudHandoffFollowUp(targetSessionId);
	if (!saved) return await send();
	const matches = (record: CloudHandoffFollowUp | null) =>
		Boolean(
			record &&
				record.draftId === saved.draftId &&
				record.sourceSessionId === saved.sourceSessionId &&
				record.command.trim() === command.trim() &&
				isDeepStrictEqual(record.userImages, userImages),
		);
	const activeSends = activeRecoverySends.get(targetSessionId) ?? 0;
	const ownsDraft =
		matches(saved) ||
		(activeSends === 0 && !saved.unconfirmed && saved.draftId === draftId);
	const lifecycle: CloudSendLifecycle = {
		beforeDispatch: () => {
			const current = readCloudHandoffFollowUp(targetSessionId);
			if (!current) return;
			const markUnconfirmed = ownsDraft && matches(current);
			if (!current.initialTask && !markUnconfirmed) return;
			const { initialTask: _, ...dispatched } = current;
			saveCloudHandoffFollowUp(targetSessionId, {
				...dispatched,
				...(markUnconfirmed ? { unconfirmed: true } : {}),
			});
		},
	};
	if (!ownsDraft) return await send(lifecycle);
	activeRecoverySends.set(targetSessionId, activeSends + 1);
	try {
		if (!matches(saved))
			saveCloudHandoffFollowUp(targetSessionId, {
				...saved,
				command,
				userImages,
			});
		const result = await send(lifecycle);
		if (!result.recoveredAfterDisconnect) {
			try {
				if (matches(readCloudHandoffFollowUp(targetSessionId)))
					clearCloudHandoffFollowUp(targetSessionId);
			} catch {
				console.warn(
					"Could not clear the confirmed cloud follow-up recovery copy.",
				);
			}
		}
		return result;
	} finally {
		const remaining = (activeRecoverySends.get(targetSessionId) as number) - 1;
		if (remaining > 0) activeRecoverySends.set(targetSessionId, remaining);
		else activeRecoverySends.delete(targetSessionId);
	}
}
