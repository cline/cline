/**
 * Persisted broker state: UI-safe metadata plus the last replay cursor,
 * NOTHING else. No message content, no secrets, no filesystem paths of
 * the Gateway. Written 0600, atomically, and only after events have
 * been committed into the local projection.
 */

import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const PersistedDesktopStateSchema = z
	.object({
		v: z.literal(1),
		gatewayId: z.string().min(1).optional(),
		clientId: z.string().min(1).optional(),
		/** Last event sequence committed into the projection. */
		cursorSequence: z.number().int().min(-1),
		selectedBotId: z.string().min(1).optional(),
		selectedSessionId: z.string().min(1).optional(),
		selectedWorkspaceId: z.string().min(1).optional(),
	})
	.strict();

export type PersistedDesktopState = z.infer<typeof PersistedDesktopStateSchema>;

export function initialPersistedState(): PersistedDesktopState {
	return { v: 1, cursorSequence: -1 };
}

export class DesktopStateStore {
	private readonly file: string;
	private state: PersistedDesktopState;

	constructor(file: string) {
		this.file = file;
		this.state = this.load();
	}

	get current(): PersistedDesktopState {
		return this.state;
	}

	private load(): PersistedDesktopState {
		try {
			const parsed = PersistedDesktopStateSchema.safeParse(
				JSON.parse(readFileSync(this.file, "utf8")),
			);
			if (parsed.success) {
				return parsed.data;
			}
		} catch {
			// Missing or corrupt state is not an error: start fresh.
		}
		return initialPersistedState();
	}

	save(update: Partial<Omit<PersistedDesktopState, "v">>): void {
		this.state = PersistedDesktopStateSchema.parse({
			...this.state,
			...update,
		});
		mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
		const temp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temp, `${JSON.stringify(this.state, null, "\t")}\n`, {
			mode: 0o600,
		});
		chmodSync(temp, 0o600);
		renameSync(temp, this.file);
	}

	/** Forget everything tied to a Gateway identity (gatewayId changed). */
	reset(): void {
		this.state = initialPersistedState();
		this.save({});
	}
}
