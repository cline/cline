import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createUxVerifierTool } from "./ux-verifier-tool";
const context = { agentId: "lead", iteration: 1 };
const input = {
	title: "Checkout UX",
	task: "Inspect the flow",
	url: "http://localhost:3000",
	checklist: [
		{
			id: "dialog",
			title: "Dialog opens",
			steps: ["Click Open"],
			expected: "The dialog is visible",
		},
		{
			id: "keyboard",
			title: "Keyboard works",
			steps: ["Press Escape"],
			expected: "The dialog closes",
		},
	],
};
const temporary: string[] = [];
afterEach(async () => {
	for (const path of temporary.splice(0))
		await rm(path, { recursive: true, force: true });
});
it("delegates the checklist and returns ordered, captured image evidence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ux-verifier-"));
	temporary.push(dir);
	const path = join(dir, "capture.png");
	await writeFile(
		path,
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=",
			"base64",
		),
	);
	const delegate = {
		execute: vi.fn().mockResolvedValue({
			text: JSON.stringify({
				subtitle: "Chrome · actual local browser",
				checks: [
					{
						id: "keyboard",
						title: "Keyboard blocked",
						subtitle: "Permission required",
						status: "blocked",
					},
					{
						id: "dialog",
						title: "Dialog opens",
						subtitle: "The modal is visible",
						status: "passed",
						screenshotPath: path,
					},
				],
			}),
		}),
	};
	const result = await createUxVerifierTool(delegate).execute(input, context);
	expect(delegate.execute).toHaveBeenCalledOnce();
	expect(delegate.execute.mock.calls[0][1]).toBe(context);
	expect(JSON.parse(delegate.execute.mock.calls[0][0].task)).toEqual(input);
	expect(delegate.execute.mock.calls[0][0].systemPrompt).toContain(
		"Do not skip any checklist ID",
	);
	expect(result.checks.map((check) => check.id)).toEqual([
		"dialog",
		"keyboard",
	]);
	expect(result.checks[0].screenshot).toMatchObject({
		type: "image",
		mediaType: "image/png",
	});
	expect(result.checks[1].screenshot).toBeUndefined();
});
it.each([
	{
		subtitle: "Chrome",
		checks: [
			{ id: "dialog", title: "Done", subtitle: "Blocked", status: "blocked" },
		],
	},
	{
		subtitle: "Chrome",
		checks: [
			{ id: "dialog", title: "Done", subtitle: "Blocked", status: "blocked" },
			{ id: "dialog", title: "Done", subtitle: "Blocked", status: "blocked" },
		],
	},
])("rejects missing or duplicated checklist coverage", async (report) => {
	await expect(
		createUxVerifierTool({
			execute: async () => ({ text: JSON.stringify(report) }),
		}).execute(input, context),
	).rejects.toThrow("every checklist ID exactly once");
});
it("never accepts a passed claim without screenshot evidence", async () => {
	const checks = input.checklist.map((check) => ({
		id: check.id,
		title: check.title,
		subtitle: "Claimed success",
		status: "passed",
	}));
	await expect(
		createUxVerifierTool({
			execute: async () => ({
				text: JSON.stringify({ subtitle: "Chrome", checks }),
			}),
		}).execute(input, context),
	).rejects.toThrow("require screenshot evidence");
});
it("rejects prose instead of a report and respects cancellation before delegation", async () => {
	const delegate = {
		execute: vi.fn().mockResolvedValue({ text: "Everything passed!" }),
	};
	await expect(
		createUxVerifierTool(delegate).execute(input, context),
	).rejects.toThrow("invalid JSON");
	delegate.execute.mockClear();
	const controller = new AbortController();
	controller.abort();
	await expect(
		createUxVerifierTool(delegate).execute(input, {
			...context,
			signal: controller.signal,
		}),
	).rejects.toThrow();
	expect(delegate.execute).not.toHaveBeenCalled();
});
it("rejects duplicate checklist IDs before spawning a worker", async () => {
	const delegate = { execute: vi.fn() };
	await expect(
		createUxVerifierTool(delegate).execute(
			{ ...input, checklist: [input.checklist[0], input.checklist[0]] },
			context,
		),
	).rejects.toThrow("must be unique");
	expect(delegate.execute).not.toHaveBeenCalled();
});
it("rejects files that are not screenshot images", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ux-verifier-"));
	temporary.push(dir);
	const path = join(dir, "fake.png");
	await writeFile(path, "not an image");
	const checks = input.checklist.map((check) => ({
		id: check.id,
		title: check.title,
		subtitle: "Claimed success",
		status: "passed",
		screenshotPath: path,
	}));
	await expect(
		createUxVerifierTool({
			execute: async () => ({
				text: JSON.stringify({ subtitle: "Chrome", checks }),
			}),
		}).execute(input, context),
	).rejects.toThrow("PNG, JPEG, or WebP");
});
