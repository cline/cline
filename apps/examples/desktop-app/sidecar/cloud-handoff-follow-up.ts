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
import type { CloudSendLifecycle } from "@cline/core/cloud";
import { resolveClineDataDir } from "@cline/shared/storage";

export type CloudHandoffFollowUp = {
	draftId: string;
	sourceSessionId: string;
	command: string;
	userImages: string[];
	unconfirmed?: boolean;
};

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
		(value.draftId !== undefined && typeof value.draftId !== "string") ||
		(value.unconfirmed !== undefined && typeof value.unconfirmed !== "boolean")
	) {
		throw new Error("The saved cloud follow-up could not be read.");
	}
	return {
		...value,
		draftId: value.draftId ?? createHash("sha256").update(raw).digest("hex"),
	};
}

export function clearCloudHandoffFollowUp(targetSessionId: string): void {
	rmSync(followUpPath(targetSessionId), { force: true });
}

export function updateCloudHandoffFollowUp(
	targetSessionId: string,
	expected: CloudHandoffFollowUp,
	action: "restore" | "dismiss",
): CloudHandoffFollowUp | null {
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
	const matches = (record: CloudHandoffFollowUp | null) =>
		Boolean(
			record &&
				saved &&
				record.draftId === saved.draftId &&
				record.sourceSessionId === saved.sourceSessionId &&
				record.command.trim() === command.trim() &&
				isDeepStrictEqual(record.userImages, userImages),
		);
	if (
		!saved ||
		(!matches(saved) && (saved.unconfirmed || saved.draftId !== draftId))
	)
		return await send();
	if (!matches(saved))
		saveCloudHandoffFollowUp(targetSessionId, {
			...saved,
			command,
			userImages,
		});
	const clearAccepted = () => {
		try {
			if (matches(readCloudHandoffFollowUp(targetSessionId)))
				clearCloudHandoffFollowUp(targetSessionId);
		} catch {
			console.warn(
				"Could not clear the confirmed cloud follow-up recovery copy.",
			);
		}
	};
	const result = await send({
		beforeDispatch: () => {
			const current = readCloudHandoffFollowUp(targetSessionId);
			if (matches(current) && current)
				saveCloudHandoffFollowUp(targetSessionId, {
					...current,
					unconfirmed: true,
				});
		},
		onAccepted: clearAccepted,
	});
	if (!result.recoveredAfterDisconnect) clearAccepted();
	return result;
}
