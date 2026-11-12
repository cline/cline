import { describe, expect, it, vi } from "vitest";
import {
	type ImportedFactoryIssue,
	prepareFactoryIntake,
} from "./factory-intake";

const source = {
	provider: "github" as const,
	id: "I_kwDO7",
	url: "https://github.com/owner/repo/issues/7",
};

describe("prepareFactoryIntake", () => {
	it("starts a prose request as an intake without reading an issue", async () => {
		const importIssue = vi.fn<() => Promise<ImportedFactoryIssue>>();
		await expect(
			prepareFactoryIntake({
				prompt: "Export the activity view as CSV.",
				workspaceRoot: "/repo",
				importIssue,
			}),
		).resolves.toEqual({
			kind: "start",
			prompt: "Export the activity view as CSV.",
			intake: {},
		});
		expect(importIssue).not.toHaveBeenCalled();
	});

	it("imports a standalone issue link once for the active repository", async () => {
		const importIssue = vi.fn(async () => ({
			title: "Export activity",
			description: "Accept CSV downloads.",
			source,
		}));
		await expect(
			prepareFactoryIntake({
				prompt: source.url,
				workspaceRoot: "/repo",
				importIssue,
			}),
		).resolves.toEqual({
			kind: "start",
			prompt:
				"https://github.com/owner/repo/issues/7\n\nImported issue: Export activity\nhttps://github.com/owner/repo/issues/7\n\nAccept CSV downloads.",
			intake: { sourceIssue: source },
		});
		expect(importIssue).toHaveBeenCalledOnce();
		expect(importIssue).toHaveBeenCalledWith({ url: source.url, cwd: "/repo" });
	});

	it("leaves an issue URL inside a request as ordinary context", async () => {
		const prompt = `Add support for closed tasks related to ${source.url}`;
		const importIssue = vi.fn<() => Promise<ImportedFactoryIssue>>();
		await expect(
			prepareFactoryIntake({ prompt, workspaceRoot: "/repo", importIssue }),
		).resolves.toEqual({ kind: "start", prompt, intake: {} });
		expect(importIssue).not.toHaveBeenCalled();
	});

	it("keeps issue-linked attachments with the user's request", async () => {
		const prompt = source.url;
		const importIssue = vi.fn<() => Promise<ImportedFactoryIssue>>();
		await expect(
			prepareFactoryIntake({
				prompt,
				workspaceRoot: "/repo",
				hasAttachments: true,
				importIssue,
			}),
		).resolves.toEqual({ kind: "start", prompt, intake: {} });
		expect(importIssue).not.toHaveBeenCalled();
	});

	it("opens an issue already tracked as a card instead of starting a chat", async () => {
		await expect(
			prepareFactoryIntake({
				prompt: "https://linear.app/Example/issue/app-7/slow-search",
				workspaceRoot: "/repo",
				importIssue: async ({ url }) => {
					expect(url).toBe("https://linear.app/example/issue/APP-7");
					return {
						title: "Slow search",
						description: "",
						source: { provider: "linear", id: "issue-7", url },
						existingTaskId: "task_existing",
					};
				},
			}),
		).resolves.toEqual({ kind: "existing", taskId: "task_existing" });
	});

	it("surfaces importer failures rather than starting without the source", async () => {
		await expect(
			prepareFactoryIntake({
				prompt: source.url,
				workspaceRoot: "/repo",
				importIssue: async () => {
					throw new Error("Check your Linear credentials and issue access.");
				},
			}),
		).rejects.toThrow("Check your Linear credentials and issue access.");
	});
});
