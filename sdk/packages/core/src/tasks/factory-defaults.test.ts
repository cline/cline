import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FACTORY_DEFAULTS_FILE_NAME,
	FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW,
	FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW_NAME,
	FileFactoryDefaultsStore,
	resolveFactoryDefaultsPath,
} from "./factory-defaults";
import { createFactoryWorkflowRecipe } from "./factory-workflow-recipe";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "cline-factory-defaults-"));
	roots.push(root);
	return root;
}

const recipe = createFactoryWorkflowRecipe({
	name: "Hands-off",
	config: { approval: "automatic", autonomy: "hands_off" },
});

describe("FileFactoryDefaultsStore", () => {
	it("stores the default beside the task database and keeps an in-memory database in memory", () => {
		expect(resolveFactoryDefaultsPath("/data/cline/tasks.db")).toBe(
			join("/data/cline", FACTORY_DEFAULTS_FILE_NAME),
		);
		expect(resolveFactoryDefaultsPath(":memory:")).toBeUndefined();
	});

	it("persists, replaces and clears the default across instances", async () => {
		const root = tempRoot();
		const path = join(root, "nested", FACTORY_DEFAULTS_FILE_NAME);
		const store = new FileFactoryDefaultsStore(path);
		await expect(store.getDefaultWorkflow()).resolves.toBeUndefined();

		await expect(
			store.setDefaultWorkflow(JSON.parse(JSON.stringify(recipe))),
		).resolves.toEqual(recipe);
		await expect(
			new FileFactoryDefaultsStore(path).getDefaultWorkflow(),
		).resolves.toEqual(recipe);
		// The atomic write leaves no temporary files behind; the marker records
		// that the file existed.
		expect(readdirSync(join(root, "nested")).sort()).toEqual([
			FACTORY_DEFAULTS_FILE_NAME,
			`${FACTORY_DEFAULTS_FILE_NAME}.written`,
		]);

		await store.clearDefaultWorkflow();
		await expect(store.getDefaultWorkflow()).resolves.toBeUndefined();
		// A clear is a received default too: the file keeps only that marker.
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			version: 1,
			defaultsReceived: true,
		});
		// Clearing twice is harmless.
		await store.clearDefaultWorkflow();
	});

	it("rejects an invalid recipe without changing the stored default", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		const store = new FileFactoryDefaultsStore(path);
		await store.setDefaultWorkflow(recipe);
		const before = readFileSync(path, "utf8");

		await expect(
			store.setDefaultWorkflow({
				...recipe,
				config: { ...recipe.config, approval: "required" },
			}),
		).rejects.toThrow("Workflow revision does not match its configuration");
		await expect(store.setDefaultWorkflow({ name: "x" })).rejects.toThrow();
		expect(readFileSync(path, "utf8")).toBe(before);
		await expect(store.getDefaultWorkflow()).resolves.toEqual(recipe);
	});

	it("fails closed on a corrupt file: paused, no defaults received, plans wait for approval, logged once", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		writeFileSync(
			path,
			JSON.stringify({ version: 1, concurrency: 3, workflow: recipe }).slice(
				0,
				-5,
			),
		);
		const logs: string[] = [];
		const store = new FileFactoryDefaultsStore(path, {
			logger: { debug: () => {}, log: (message) => logs.push(message) },
		});
		await expect(store.getPaused()).resolves.toBe(true);
		await expect(store.getDefaultsReceived()).resolves.toBe(false);
		await expect(store.getConcurrency()).resolves.toBeUndefined();
		const fallback = await store.getDefaultWorkflow();
		expect(fallback).toEqual(FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW);
		expect(fallback?.name).toBe(FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW_NAME);
		expect(fallback?.config).toMatchObject({
			approval: "required",
			maxCostUsd: 10,
		});
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain("Factory defaults unusable");

		// A host's next push repairs the file; the pause stays until cleared.
		await store.setDefaultWorkflow(recipe);
		await expect(store.getDefaultWorkflow()).resolves.toEqual(recipe);
		await expect(store.getDefaultsReceived()).resolves.toBe(true);
		await expect(store.getPaused()).resolves.toBe(true);
		await store.setPaused(false);
		await expect(store.getPaused()).resolves.toBe(false);
	});

	it("treats a file deleted after it was written as corrupt: paused and approval required", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		const store = new FileFactoryDefaultsStore(path, {
			logger: { debug: () => {}, log: () => {} },
		});
		await store.setDefaultWorkflow(recipe);
		rmSync(path);
		await expect(store.getPaused()).resolves.toBe(true);
		await expect(store.getDefaultWorkflow()).resolves.toEqual(
			FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW,
		);
		await expect(store.getDefaultsReceived()).resolves.toBe(false);
	});

	it("treats a missing file as empty, not corrupt", async () => {
		const store = new FileFactoryDefaultsStore(
			join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME),
		);
		await expect(store.getPaused()).resolves.toBe(false);
		await expect(store.getDefaultWorkflow()).resolves.toBeUndefined();
	});

	it("serves the approval-required stand-in for an invalid stored workflow instead of no default", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				defaultsReceived: true,
				workflow: {
					...recipe,
					config: { ...recipe.config, approval: "required" },
				},
			}),
		);
		const store = new FileFactoryDefaultsStore(path, {
			logger: { debug: () => {}, log: () => {} },
		});
		await expect(store.getDefaultWorkflow()).resolves.toEqual(
			FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW,
		);
		// The rest of the file is fine: not paused.
		await expect(store.getPaused()).resolves.toBe(false);
		await store.setDefaultWorkflow(recipe);
		await expect(store.getDefaultWorkflow()).resolves.toEqual(recipe);
	});

	it("stores the daily spending limit, rejects invalid amounts and stores null (or 0) as no daily limit", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		const store = new FileFactoryDefaultsStore(path);
		// Never set: the default applies.
		await expect(store.getDailyCostUsd()).resolves.toBeUndefined();
		await expect(store.setDailyCostUsd(25.5)).resolves.toBe(25.5);
		await expect(
			new FileFactoryDefaultsStore(path).getDailyCostUsd(),
		).resolves.toBe(25.5);
		for (const invalid of [-1, Number.NaN, "5", 200_000, undefined])
			await expect(store.setDailyCostUsd(invalid)).rejects.toThrow(
				"daily spending limit",
			);
		await expect(store.getDailyCostUsd()).resolves.toBe(25.5);
		// "No daily limit" is stored and survives a restart; 0 means the same.
		for (const none of [null, 0]) {
			await store.setDailyCostUsd(25.5);
			await expect(store.setDailyCostUsd(none)).resolves.toBeNull();
			await expect(
				new FileFactoryDefaultsStore(path).getDailyCostUsd(),
			).resolves.toBeNull();
		}
		// The default comes back only by sending it.
		await expect(store.setDailyCostUsd(50)).resolves.toBe(50);
	});

	it("keeps the default in memory without a path", async () => {
		const store = new FileFactoryDefaultsStore();
		await store.setDefaultWorkflow(recipe);
		await expect(store.getDefaultWorkflow()).resolves.toEqual(recipe);
		await store.clearDefaultWorkflow();
		await expect(store.getDefaultWorkflow()).resolves.toBeUndefined();
	});

	it("stores the working limit beside the workflow, keeps old files readable and clears only the workflow", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		// A file written before the limit existed.
		writeFileSync(path, JSON.stringify({ version: 1, workflow: recipe }));
		const store = new FileFactoryDefaultsStore(path);
		await expect(store.getConcurrency()).resolves.toBeUndefined();
		await expect(store.getDefaultWorkflow()).resolves.toEqual(recipe);

		await expect(store.setConcurrency(3)).resolves.toBe(3);
		const reopened = new FileFactoryDefaultsStore(path);
		await expect(reopened.getConcurrency()).resolves.toBe(3);
		await expect(reopened.getDefaultWorkflow()).resolves.toEqual(recipe);

		for (const invalid of [0, 9, 2.5, "4", null])
			await expect(store.setConcurrency(invalid)).rejects.toThrow(
				"Factory concurrency must be an integer from 1 to 8",
			);
		await expect(store.getConcurrency()).resolves.toBe(3);

		await store.clearDefaultWorkflow();
		await expect(store.getDefaultWorkflow()).resolves.toBeUndefined();
		await expect(
			new FileFactoryDefaultsStore(path).getConcurrency(),
		).resolves.toBe(3);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			version: 1,
			concurrency: 3,
			defaultsReceived: true,
		});
	});

	it("records whether a default was ever received, and the pause, across instances", async () => {
		const path = join(tempRoot(), FACTORY_DEFAULTS_FILE_NAME);
		const store = new FileFactoryDefaultsStore(path);
		await expect(store.getDefaultsReceived()).resolves.toBe(false);
		await expect(store.getPaused()).resolves.toBe(false);
		// A limit alone is not a default.
		await store.setConcurrency(2);
		await expect(store.getDefaultsReceived()).resolves.toBe(false);
		await store.setPaused(true);
		await store.clearDefaultWorkflow();
		const reopened = new FileFactoryDefaultsStore(path);
		await expect(reopened.getDefaultsReceived()).resolves.toBe(true);
		await expect(reopened.getPaused()).resolves.toBe(true);
		await reopened.setPaused(false);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			version: 1,
			concurrency: 2,
			defaultsReceived: true,
		});
		// Without a path everything stays in memory, starting unreceived.
		await expect(
			new FileFactoryDefaultsStore().getDefaultsReceived(),
		).resolves.toBe(false);
	});
});
