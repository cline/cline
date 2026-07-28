import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMessage } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionMailStore } from "../../types/storage";
import { FileSessionMailStore } from "./file-session-mail-store";
import { SqliteSessionMailStore } from "./sqlite-session-mail-store";

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
	return {
		id: "smsg_1",
		fromSessionId: "alpha",
		fromLabel: "alpha session",
		toSessionId: "beta",
		subject: "subject",
		body: "body",
		delivery: "queue",
		status: "pending",
		hopCount: 1,
		hopChain: ["alpha"],
		sentAt: new Date("2026-07-27T10:00:00.000Z"),
		...overrides,
	};
}

/**
 * Both stores back the same contract, so the suite runs against each. SQLite
 * is skipped when the native binding is unavailable, which is the same
 * condition that makes `createLocalSessionMailStore` fall back to files.
 */
function sqliteAvailable(dir: string): boolean {
	try {
		new SqliteSessionMailStore({ mailDir: dir }).init();
		return true;
	} catch {
		return false;
	}
}

describe("session mail stores", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cline-mail-store-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	const implementations: Array<{
		name: string;
		create: (dir: string) => SessionMailStore;
		skip?: (dir: string) => boolean;
	}> = [
		{
			name: "FileSessionMailStore",
			create: (dir) => new FileSessionMailStore({ mailDir: dir }),
		},
		{
			name: "SqliteSessionMailStore",
			create: (dir) => new SqliteSessionMailStore({ mailDir: dir }),
			skip: (dir) => !sqliteAvailable(dir),
		},
	];

	for (const impl of implementations) {
		describe(impl.name, () => {
			it("round-trips a message", () => {
				if (impl.skip?.(tempDir)) return;
				const store = impl.create(tempDir);
				store.init();
				const message = makeMessage();
				store.append(message);

				const loaded = store.get("smsg_1");
				expect(loaded?.subject).toBe("subject");
				expect(loaded?.hopChain).toEqual(["alpha"]);
				expect(loaded?.sentAt.toISOString()).toBe("2026-07-27T10:00:00.000Z");
			});

			it("lists only the addressed session's inbox", () => {
				if (impl.skip?.(tempDir)) return;
				const store = impl.create(tempDir);
				store.init();
				store.append(makeMessage({ id: "a", toSessionId: "beta" }));
				store.append(makeMessage({ id: "b", toSessionId: "gamma" }));

				expect(store.listInbox("beta").map((m) => m.id)).toEqual(["a"]);
			});

			it("applies delivered and read transitions", () => {
				if (impl.skip?.(tempDir)) return;
				const store = impl.create(tempDir);
				store.init();
				store.append(makeMessage());

				store.markDelivered("smsg_1");
				expect(store.get("smsg_1")?.status).toBe("delivered");
				expect(store.get("smsg_1")?.deliveredAt).toBeInstanceOf(Date);

				store.markRead(["smsg_1"]);
				expect(store.get("smsg_1")?.status).toBe("read");
				expect(store.listInbox("beta", { unreadOnly: true })).toHaveLength(0);
			});

			it("hides dropped messages from the inbox", () => {
				if (impl.skip?.(tempDir)) return;
				const store = impl.create(tempDir);
				store.init();
				store.append(makeMessage());
				store.markDropped("smsg_1", "hop_limit");

				expect(store.listInbox("beta")).toHaveLength(0);
				expect(store.get("smsg_1")?.droppedReason).toBe("hop_limit");
			});

			it("filters pending messages for draining", () => {
				if (impl.skip?.(tempDir)) return;
				const store = impl.create(tempDir);
				store.init();
				store.append(makeMessage({ id: "a" }));
				store.append(makeMessage({ id: "b" }));
				store.markDelivered("a");

				expect(
					store.listInbox("beta", { status: "pending" }).map((m) => m.id),
				).toEqual(["b"]);
			});

			it("counts sends within a window", () => {
				if (impl.skip?.(tempDir)) return;
				const store = impl.create(tempDir);
				store.init();
				store.append(
					makeMessage({ id: "old", sentAt: new Date("2026-07-27T09:00:00Z") }),
				);
				store.append(
					makeMessage({ id: "new", sentAt: new Date("2026-07-27T10:00:00Z") }),
				);

				expect(
					store.countSentSince("alpha", new Date("2026-07-27T09:30:00Z")),
				).toBe(1);
			});

			it("survives being reopened", () => {
				if (impl.skip?.(tempDir)) return;
				const first = impl.create(tempDir);
				first.init();
				first.append(makeMessage());
				first.markDelivered("smsg_1");

				const second = impl.create(tempDir);
				second.init();
				expect(second.get("smsg_1")?.status).toBe("delivered");
			});
		});
	}
});
