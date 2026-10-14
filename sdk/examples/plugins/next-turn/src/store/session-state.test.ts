import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_STATE_TTL_MS } from "../config";
import { EMPTY_BACKLOG } from "../planner/backlog";
import { LabelLog } from "../planner/labels";
import { NextSession } from "../planner/next";
import { defaultSettings } from "../settings/settings";
import { editRun, message, useTempDirs } from "../test-support";
import {
	FileSessionStateStore,
	pruneSessionStates,
	updateSessionState,
} from "./session-state";

const tempDir = useTempDirs("next-turn-session-state-");

describe("session state persistence across sandbox respawn", () => {
	test("rehydrates the active offerId, labels the next message once, and skips through the stored pool without a planner call", async () => {
		const dir = tempDir();
		const labelsPath = join(dir, "labels.jsonl");
		const sessionsDir = join(dir, "sessions");
		let plannerCalls = 0;

		const makeSession = () =>
			new NextSession({
				sessionId: "sess_respawn",
				settings: defaultSettings,
				env: () => ({ client: "cline-desktop", tools: [] }),
				sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
				backlog: async () => EMPTY_BACKLOG,
				complete: async () => {
					plannerCalls += 1;
					return {
						text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test on client.ts.","why":"client.ts changed"},{"kind":"wrap_up","source":"turn","prompt":"Summarize the client changes.","why":"done"}]}',
					};
				},
				labels: new LabelLog(labelsPath),
				store: new FileSessionStateStore(sessionsDir, "sess_respawn"),
				viewerClient: () => "cline-desktop",
			});

		const first = makeSession();
		const { result, messages } = editRun();
		await first.afterRun(result);
		await first.settled();
		const originalOffer = first.current();
		expect(originalOffer?.planner).toBe("model");
		expect(plannerCalls).toBe(1);

		const respawned = makeSession();
		expect(respawned.current()?.offerId).toBe(originalOffer?.offerId);
		expect(respawned.currentPush().state).toBe("ready");

		const firstCandidate = originalOffer?.candidates[0];
		const afterSkip = respawned.invoke({
			type: "skip",
			candidateId: firstCandidate?.id ?? "",
			offerId: originalOffer?.offerId,
		}).set;
		expect(plannerCalls).toBe(1);
		expect(afterSkip?.candidates.map((row) => row.id)).not.toContain(
			firstCandidate?.id,
		);

		const secondRespawn = makeSession();
		const remaining = secondRespawn.current()?.candidates[0];
		secondRespawn.outgoing([
			...messages,
			message("user", remaining?.prompt ?? ""),
		]);
		expect(secondRespawn.current()).toBeUndefined();

		const thirdRespawn = makeSession();
		expect(thirdRespawn.current()).toBeUndefined();

		const records = readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { event: string });
		expect(records.filter((r) => r.event === "do")).toHaveLength(1);
	});

	test("a turn saved before the manifest was persisted still serves a skip after a respawn", async () => {
		const dir = tempDir();
		const makeSession = () =>
			new NextSession({
				sessionId: "sess_old_format",
				settings: defaultSettings,
				env: () => ({ client: "cline-desktop", tools: [] }),
				sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
				backlog: async () => EMPTY_BACKLOG,
				store: new FileSessionStateStore(dir, "sess_old_format"),
			});
		const first = makeSession();
		await first.afterRun(editRun().result);
		await first.settled();
		const offer = first.current();
		const skipped = offer?.candidates[0];
		expect(skipped).toBeDefined();

		const [fileName] = readdirSync(dir);
		const filePath = join(dir, fileName);
		const saved = JSON.parse(readFileSync(filePath, "utf8"));
		delete saved.turnState.manifest;
		delete saved.turnState.trigger;
		writeFileSync(filePath, `${JSON.stringify(saved)}\n`);

		const respawned = makeSession();
		const push = respawned.invoke({
			type: "skip",
			candidateId: skipped?.id ?? "",
			offerId: offer?.offerId,
		});
		expect(push.set?.offerId).not.toBe(offer?.offerId);
		expect(push.set?.excluded).toContain(skipped?.prompt);
	});

	test("updating the stored state keeps the fields the update does not name, and clears the ones it sets undefined", () => {
		const dir = tempDir();
		const store = new FileSessionStateStore(dir, "sess_merge");
		store.write({
			hiddenForChat: true,
			seq: 7,
			lastPush: { sessionId: "sess_merge", seq: 7, state: "off" },
			lastChat: { providerId: "anthropic", modelId: "claude" },
		});
		updateSessionState(store, {
			viewerClient: "cline-desktop",
			lastPush: undefined,
		});
		const merged = {
			hiddenForChat: true,
			seq: 7,
			lastChat: { providerId: "anthropic", modelId: "claude" },
			viewerClient: "cline-desktop",
		};
		expect(store.read()).toMatchObject(merged);
		const reread = new FileSessionStateStore(dir, "sess_merge").read();
		expect(reread).toMatchObject(merged);
		expect(reread?.lastPush).toBeUndefined();
	});

	test("a store answers from what it last wrote, and its state still expires after the TTL", () => {
		const dir = tempDir();
		let now = 1_000;
		const store = new FileSessionStateStore(dir, "sess_ttl", () => now);
		store.write({ seq: 3 });
		expect(store.read()?.seq).toBe(3);
		expect(
			new FileSessionStateStore(dir, "sess_ttl", () => now).read()?.seq,
		).toBe(3);
		now += SESSION_STATE_TTL_MS + 1;
		expect(store.read()).toBeUndefined();
		expect(readdirSync(dir)).toEqual([]);
	});

	test("pruning deletes state files and leftover temporary files older than the TTL", async () => {
		const dir = tempDir();
		const now = Date.now();
		const stale = new Date(now - SESSION_STATE_TTL_MS - 86_400_000);
		for (const name of ["old.json", "old.json.123.abc.tmp"]) {
			writeFileSync(join(dir, name), "{}\n");
			utimesSync(join(dir, name), stale, stale);
		}
		writeFileSync(join(dir, "fresh.json"), "{}\n");
		await pruneSessionStates(dir, now);
		expect(readdirSync(dir)).toEqual(["fresh.json"]);
		await pruneSessionStates(join(dir, "missing"), now);
	});
});
