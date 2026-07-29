/**
 * Append-only room event log (ARD-0013 lane 1).
 * JSONL under `.cline/drive/rooms/<roomId>/events.jsonl` + `meta.json`.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	type DriveEvent,
	parseDriveEvent,
	resolveDriveRoomEventsPath,
	resolveDriveRoomMetaPath,
} from "@cline/shared";

export type RoomLogRecord = {
	readonly seq: number;
	readonly event: DriveEvent;
};

export type RoomEventLog = {
	appendSync(roomId: string, event: DriveEvent): RoomLogRecord;
	readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]>;
	/** Sync gap read for hub command handlers. */
	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[];
	latestSeq(roomId: string): number;
};

type MetaFile = {
	schemaVersion: 1;
	nextSeq: number;
};

function readMeta(path: string): MetaFile {
	if (!existsSync(path)) {
		return { schemaVersion: 1, nextSeq: 1 };
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as MetaFile;
	return {
		schemaVersion: 1,
		nextSeq: typeof raw.nextSeq === "number" ? raw.nextSeq : 1,
	};
}

function writeMetaAtomic(path: string, meta: MetaFile): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(meta)}\n`, "utf8");
	renameSync(tmp, path);
}

/**
 * File-backed room event log for a workspace config parent
 * (`<workspace>` or similar — used with resolveDriveConfigDir).
 */
export class JsonlRoomEventLog implements RoomEventLog {
	constructor(private readonly configParent: string) {}

	latestSeq(roomId: string): number {
		const meta = readMeta(resolveDriveRoomMetaPath(this.configParent, roomId));
		return Math.max(0, meta.nextSeq - 1);
	}

	appendSync(roomId: string, event: DriveEvent): RoomLogRecord {
		const metaPath = resolveDriveRoomMetaPath(this.configParent, roomId);
		const eventsPath = resolveDriveRoomEventsPath(this.configParent, roomId);
		mkdirSync(dirname(eventsPath), { recursive: true });
		const meta = readMeta(metaPath);
		const seq = meta.nextSeq;
		const record: RoomLogRecord = { seq, event };
		appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, "utf8");
		writeMetaAtomic(metaPath, { schemaVersion: 1, nextSeq: seq + 1 });
		return record;
	}

	async readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]> {
		return this.readSinceSync(roomId, afterSeq);
	}

	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[] {
		const eventsPath = resolveDriveRoomEventsPath(this.configParent, roomId);
		if (!existsSync(eventsPath)) {
			return [];
		}
		const text = readFileSync(eventsPath, "utf8");
		const out: RoomLogRecord[] = [];
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const raw = JSON.parse(trimmed) as { seq?: unknown; event?: unknown };
			if (typeof raw.seq !== "number" || raw.seq <= afterSeq) {
				continue;
			}
			out.push({
				seq: raw.seq,
				event: parseDriveEvent(raw.event),
			});
		}
		return out;
	}
}

/** In-memory log for unit tests (no disk). */
export class MemoryRoomEventLog implements RoomEventLog {
	private readonly byRoom = new Map<string, RoomLogRecord[]>();

	latestSeq(roomId: string): number {
		const records = this.byRoom.get(roomId) ?? [];
		const last = records[records.length - 1];
		return last?.seq ?? 0;
	}

	appendSync(roomId: string, event: DriveEvent): RoomLogRecord {
		const list = this.byRoom.get(roomId) ?? [];
		const last = list[list.length - 1];
		const seq = last ? last.seq + 1 : 1;
		const record = { seq, event };
		list.push(record);
		this.byRoom.set(roomId, list);
		return record;
	}

	async readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]> {
		return this.readSinceSync(roomId, afterSeq);
	}

	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[] {
		return (this.byRoom.get(roomId) ?? []).filter((r) => r.seq > afterSeq);
	}
}
