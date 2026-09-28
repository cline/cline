import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export type CloudHandoffFollowUp = {
	sourceSessionId: string;
	command: string;
	userImages: string[];
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
	followUp: CloudHandoffFollowUp,
): void {
	const path = followUpPath(targetSessionId);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, JSON.stringify(followUp), { mode: 0o600 });
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
		!value.userImages.every((image) => typeof image === "string")
	) {
		throw new Error("The saved cloud follow-up could not be read.");
	}
	return value;
}

export function clearCloudHandoffFollowUp(targetSessionId: string): void {
	rmSync(followUpPath(targetSessionId), { force: true });
}
