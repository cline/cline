import { describe, expect, it } from "vitest";
import {
	cloudExecutionTargetId,
	ExecutionTargetStore,
	type TargetPersistence,
} from "./execution-target-store";

function memoryPersistence(): TargetPersistence & { value: string | null } {
	return {
		value: null,
		async getItem() {
			return this.value;
		},
		async setItem(_key, value) {
			this.value = value;
		},
		async deleteItem() {
			this.value = null;
		},
	};
}

describe("ExecutionTargetStore", () => {
	it("persists Cloud creation defaults without credentials", async () => {
		const persistence = memoryPersistence();
		const store = new ExecutionTargetStore(persistence);
		const target = await store.saveCloudTarget({
			repoUrl: "https://github.com/cline/cline",
			label: "cline/cline",
			modelId: "anthropic/claude-sonnet-5",
		});

		expect(target.id).toBe(
			cloudExecutionTargetId({
				repoUrl: "https://github.com/cline/cline",
			}),
		);
		expect(persistence.value).not.toContain("token");

		const restored = new ExecutionTargetStore(persistence);
		await restored.hydrate();
		expect(restored.get()).toEqual({
			cloudTargets: [target],
			cloudModelPreferences: [{ modelId: target.modelId }],
			lastTargetId: target.id,
		});
	});

	it("drops corrupt rows instead of inventing runnable targets", async () => {
		const persistence = memoryPersistence();
		persistence.value = JSON.stringify({
			cloudTargets: [{ mode: "cloud", repoUrl: 4 }],
			lastTargetId: 12,
		});
		const store = new ExecutionTargetStore(persistence);
		await store.hydrate();
		expect(store.get()).toEqual({
			cloudTargets: [],
			cloudModelPreferences: [],
		});
	});
});

describe("branch on a cloud target", () => {
	it("persists an explicit branch and omits an absent one", async () => {
		const store = new ExecutionTargetStore();
		const withBranch = await store.saveCloudTarget({
			repoUrl: "https://github.com/o/r",
			label: "o/r",
			modelId: "m1",
			branch: " develop ",
		});
		expect(withBranch.branch).toBe("develop");

		const without = await store.saveCloudTarget({
			repoUrl: "https://github.com/o/other",
			label: "o/other",
			modelId: "m1",
		});
		// Absent means "the repository's default", resolved at session start —
		// not an empty string that would be sent as a branch named "".
		expect("branch" in without).toBe(false);
	});
});

describe("remembered account preferences", () => {
	it("restores a model picked before any repository, separately for each organization", async () => {
		const persistence = memoryPersistence();
		const store = new ExecutionTargetStore(persistence);
		await store.saveCloudModel("personal/model");
		await store.saveCloudModel("team/model", "team");
		const restored = new ExecutionTargetStore(persistence);
		await restored.hydrate();
		expect(restored.get().cloudTargets).toEqual([]);
		expect(restored.get().cloudModelPreferences).toEqual([
			{ organizationId: "team", modelId: "team/model" },
			{ modelId: "personal/model" },
		]);
	});

	it("remembers the selected repository and updates its model without changing the repository or other accounts", async () => {
		const persistence = memoryPersistence();
		const store = new ExecutionTargetStore(persistence);
		const first = await store.saveCloudTarget({
			repoUrl: "https://github.com/o/first",
			label: "o/first",
			modelId: "old",
			branch: "work",
		});
		await store.saveCloudTarget({
			repoUrl: "https://github.com/o/second",
			label: "o/second",
			modelId: "old",
		});
		await store.select(first.id);
		const team = await store.saveCloudTarget({
			repoUrl: "https://github.com/o/team",
			label: "o/team",
			modelId: "team/model",
			organizationId: "team",
		});
		await store.saveCloudModel("new/model");
		expect(store.get().cloudTargets).toMatchObject([
			{ id: team.id, modelId: "team/model" },
			{ id: first.id, modelId: "new/model", branch: "work" },
			{ label: "o/second", modelId: "new/model" },
		]);
		expect(JSON.parse(persistence.value ?? "null").cloudTargets).toEqual(
			store.get().cloudTargets,
		);
		expect(persistence.value).not.toContain("fallbackModelId");
		const restored = new ExecutionTargetStore(persistence);
		await restored.hydrate();
		expect(restored.get().lastTargetId).toBe(team.id);
		expect(
			restored.get().cloudTargets.filter((row) => !row.organizationId),
		).toMatchObject([
			{ id: first.id, modelId: "new/model", branch: "work" },
			{ label: "o/second", modelId: "new/model" },
		]);
		expect(
			restored.get().cloudTargets.find((row) => row.id === team.id)?.modelId,
		).toBe("team/model");
	});

	it("migrates existing installs using the selected repository's model", async () => {
		const persistence = memoryPersistence();
		persistence.value = JSON.stringify({
			cloudTargets: [
				{
					id: "other",
					mode: "cloud",
					repoUrl: "https://github.com/o/other",
					label: "o/other",
					modelId: "other/model",
				},
				{
					id: "selected",
					mode: "cloud",
					repoUrl: "https://github.com/o/selected",
					label: "o/selected",
					modelId: "selected/model",
				},
			],
			lastTargetId: "selected",
		});
		const store = new ExecutionTargetStore(persistence);
		await store.hydrate();
		expect(store.get().cloudModelPreferences).toEqual([
			{ modelId: "selected/model" },
		]);
		expect(store.get().lastTargetId).toBe("selected");
		expect(
			store.get().cloudTargets.every((row) => row.modelId === "selected/model"),
		).toBe(true);
	});

	it("serializes overlapping writes so a slow earlier selection cannot win after restart", async () => {
		const persistence = memoryPersistence();
		let finishFirst!: () => void;
		const firstWrite = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		let writes = 0;
		persistence.setItem = async (_key, value) => {
			if (++writes === 1) await firstWrite;
			persistence.value = value;
		};
		const store = new ExecutionTargetStore(persistence);
		const earlier = store.saveCloudTarget({
			repoUrl: "https://github.com/o/repo",
			label: "o/repo",
			modelId: "old/model",
		});
		const latest = store.saveCloudModel("latest/model");
		await Promise.resolve();
		expect(writes).toBe(1);
		finishFirst();
		const [saved] = await Promise.all([earlier, latest]);
		expect(saved.modelId).toBe("latest/model");
		const restored = new ExecutionTargetStore(persistence);
		await restored.hydrate();
		expect(restored.get().cloudModelPreferences).toEqual([
			{ modelId: "latest/model" },
		]);
	});
});
