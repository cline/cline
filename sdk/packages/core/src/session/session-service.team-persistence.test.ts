import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTeamsRuntime } from "../extensions/tools/team";
import { FileTeamPersistenceStore } from "./session-service";

describe("FileTeamPersistenceStore", () => {
	it("does not create state.json for an empty runtime", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "team-store-"));
		const store = new FileTeamPersistenceStore({
			teamName: "agent-team-nmnn9",
			baseDir,
		});
		const runtime = new AgentTeamsRuntime({ teamName: "agent-team-nmnn9" });

		store.persist(runtime);

		expect(
			existsSync(join(baseDir, "agent-team-nmnn9", "state.json")),
		).toBeFalsy();
	});

	it("removes persisted state when runtime becomes empty again", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "team-store-"));
		const store = new FileTeamPersistenceStore({
			teamName: "agent-team-cleanup",
			baseDir,
		});
		const runtime = new AgentTeamsRuntime({ teamName: "agent-team-cleanup" });

		store.upsertTeammateSpec({
			agentId: "worker",
			rolePrompt: "Implement tasks",
		});
		store.persist(runtime);
		expect(
			existsSync(join(baseDir, "agent-team-cleanup", "state.json")),
		).toBeTruthy();

		store.removeTeammateSpec("worker");
		runtime.cleanup();
		store.persist(runtime);
		expect(
			existsSync(join(baseDir, "agent-team-cleanup", "state.json")),
		).toBeFalsy();
	});
});
