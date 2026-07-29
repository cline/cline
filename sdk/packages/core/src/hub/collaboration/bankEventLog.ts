/**
 * Append-only bank event log under `.cline/drive/bank/events.jsonl`.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type BankDriveEvent,
	type DriveLogEnvelope,
	parseBankDriveEvent,
	parseDriveLogEnvelope,
	resolveDriveConfigDir,
} from "@cline/shared";

type Meta = { schemaVersion: 1; nextSeq: number };

function metaPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), "bank", "meta.json");
}

function eventsPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), "bank", "events.jsonl");
}

function readMeta(path: string): Meta {
	if (!existsSync(path)) {
		return { schemaVersion: 1, nextSeq: 1 };
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as Meta;
	return {
		schemaVersion: 1,
		nextSeq: typeof raw.nextSeq === "number" ? raw.nextSeq : 1,
	};
}

export function appendBankLogEvent(
	configParent: string,
	event: BankDriveEvent,
): DriveLogEnvelope {
	const mPath = metaPath(configParent);
	const ePath = eventsPath(configParent);
	mkdirSync(dirname(ePath), { recursive: true });
	const meta = readMeta(mPath);
	const envelope: DriveLogEnvelope = {
		family: "bank",
		seq: meta.nextSeq,
		workspaceRoot: configParent,
		event,
	};
	appendFileSync(ePath, `${JSON.stringify(envelope)}\n`, "utf8");
	const tmp = `${mPath}.${process.pid}.tmp`;
	writeFileSync(
		tmp,
		`${JSON.stringify({ schemaVersion: 1, nextSeq: meta.nextSeq + 1 })}\n`,
		"utf8",
	);
	renameSync(tmp, mPath);
	return envelope;
}

export function readBankLogSince(
	configParent: string,
	afterSeq: number,
): DriveLogEnvelope[] {
	const ePath = eventsPath(configParent);
	if (!existsSync(ePath)) {
		return [];
	}
	const out: DriveLogEnvelope[] = [];
	for (const line of readFileSync(ePath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const env = parseDriveLogEnvelope(JSON.parse(trimmed));
		if (env.family === "bank" && env.seq > afterSeq) {
			parseBankDriveEvent(env.event);
			out.push(env);
		}
	}
	return out;
}
