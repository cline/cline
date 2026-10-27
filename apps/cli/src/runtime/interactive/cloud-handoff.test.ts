import type { HubCloudSessionClient } from "@cline/core/cloud";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareCloudHandoff } from "./cloud-handoff";

const helpers = vi.hoisted(() => ({
	inspect: vi.fn(),
	summarize: vi.fn(),
}));
vi.mock("@cline/core", async (original) => ({
	...(await original<typeof import("@cline/core")>()),
	summarizeConversation: helpers.summarize,
}));
vi.mock("@cline/core/cloud", async (original) => ({
	...(await original<typeof import("@cline/core/cloud")>()),
	inspectHandoffGit: helpers.inspect,
}));
const plan = {
	id: "attempt",
	root: "/tmp/example",
	workspaceRelativePath: "packages/app",
	repoUrl: "https://github.com/example/project",
	remote: "origin",
	branch: "cline/handoff-example",
	sourceBranch: "feature",
	headSha: "a".repeat(40),
	treeSha: "b".repeat(40),
	files: [{ path: "file.ts", status: " M" }],
	commits: ["1234567 Example commit"],
};
function fixture() {
	const cloud = {
		connect: vi.fn(async () => {}),
		scope: { serviceId: "hub", scopeGeneration: 1 },
		prepareHandoffRepository: vi.fn(async () => ({
			organizationId: "org-example",
		})),
		listModels: vi
			.fn<HubCloudSessionClient["listModels"]>()
			.mockResolvedValue([
				{ id: "model", name: "Example model", catalogId: "cline" },
			]),
		create: vi.fn<HubCloudSessionClient["create"]>().mockResolvedValue({
			sessionId: "ses-example",
			status: "running",
			initialSend: { sessionId: "ses-example", ok: true, queued: true },
		}),
		send: vi
			.fn<HubCloudSessionClient["send"]>()
			.mockResolvedValue({ sessionId: "ses-example", ok: true, queued: true }),
		subscribe: vi.fn<HubCloudSessionClient["subscribe"]>(() => vi.fn()),
	};
	const readSource = vi.fn(async () => ({
		sessionId: "local",
		cwd: "/tmp/example/packages/app",
		messages: [
			{ role: "user" as const, content: "Implement the example feature" },
		],
	}));
	return {
		cloud,
		readSource,
		connection: { providerId: "anthropic", modelId: "model" },
		creationOptions: { mode: "plan" as const, autoApproveTools: false },
		draft: { instruction: "Add focused tests", images: [] as string[] },
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	helpers.inspect.mockResolvedValue(plan);
	helpers.summarize.mockResolvedValue(
		"The example feature is half implemented.",
	);
});

describe("summary cloud handoff", () => {
	it("previews without publishing, then starts once from the approved capture while local work can change", async () => {
		const input = fixture();
		const prepared = await prepareCloudHandoff(input);
		expect(prepared.git).toMatchObject({
			branch: plan.branch,
			files: plan.files,
			commits: plan.commits,
		});
		expect(input.cloud.create).not.toHaveBeenCalled();
		expect(helpers.summarize).not.toHaveBeenCalled();
		input.readSource.mockRejectedValue(
			new Error("A later local turn is running"),
		);
		const progress = vi.fn();
		const starting = prepared.start(progress);
		expect(prepared.start(progress)).toBe(starting);
		const result = await starting;
		expect(await prepared.start(progress)).toEqual(result);
		expect(input.cloud.create).toHaveBeenCalledOnce();
		expect(input.cloud.create).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: plan.id,
				localGit: {
					id: plan.id,
					root: plan.root,
					workspaceRelativePath: plan.workspaceRelativePath,
					repoUrl: plan.repoUrl,
					remote: plan.remote,
					branch: plan.branch,
					headSha: plan.headSha,
					treeSha: plan.treeSha,
				},
				branch: plan.branch,
				workspaceRelativePath: "packages/app",
				mode: "plan",
				autoApproveTools: false,
				organizationId: "org-example",
				initialMessage: {
					text: "The example feature is half implemented.\n\nNext instruction from the user:\nAdd focused tests",
					images: [],
				},
			}),
			{ serviceId: "hub", scopeGeneration: 1 },
		);
		expect(result.dashboardUrl).toContain("ses-example");
		expect(input.readSource).toHaveBeenCalledTimes(2);
	});

	it("rejects a conversation that changes during capture", async () => {
		const input = fixture();
		input.readSource.mockResolvedValueOnce({
			sessionId: "other",
			cwd: "/tmp/example/packages/app",
			messages: [{ role: "user", content: "Other" }],
		});
		await expect(prepareCloudHandoff(input)).rejects.toThrow(
			"changed during capture",
		);
		expect(input.cloud.create).not.toHaveBeenCalled();
	});

	it("does not publish when summarization fails", async () => {
		const input = fixture();
		const prepared = await prepareCloudHandoff(input);
		helpers.summarize.mockRejectedValueOnce(new Error("Summary unavailable"));
		await expect(prepared.start(vi.fn())).rejects.toThrow(
			"Summary unavailable",
		);
		expect(input.cloud.create).not.toHaveBeenCalled();
	});

	it("rejects account changes after confirmation and unavailable models during preparation", async () => {
		const input = fixture();
		const prepared = await prepareCloudHandoff(input);
		input.cloud.scope = { serviceId: "hub", scopeGeneration: 2 };
		await expect(prepared.start(vi.fn())).rejects.toThrow("account changed");
		expect(input.cloud.create).not.toHaveBeenCalled();
		const second = fixture();
		second.cloud.listModels.mockResolvedValue([]);
		await expect(prepareCloudHandoff(second)).rejects.toThrow("not available");
		expect(helpers.summarize).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("reports a failed initial send without retrying (dispatched=%s)", async (dispatched) => {
		const input = fixture();
		input.cloud.create.mockResolvedValue({
			sessionId: "ses-example",
			status: "running",
			initialSend: { dispatched, message: "Synthetic send failure" },
		});
		const prepared = await prepareCloudHandoff(input);
		const result = await prepared.start(vi.fn());
		expect(result.warning).toContain(dispatched ? "unconfirmed" : "not sent");
		expect(Boolean(result.retrySend)).toBe(!dispatched);
		expect(input.cloud.create).toHaveBeenCalledOnce();
		if (!dispatched) {
			expect(result.retrySend).toBeDefined();
			await result.retrySend?.();
			expect(input.cloud.send).toHaveBeenCalledWith(
				"ses-example",
				expect.stringContaining(
					"Next instruction from the user:\nAdd focused tests",
				),
				"queue",
				"model",
				[],
			);
			expect(input.cloud.create).toHaveBeenCalledOnce();
		} else {
			expect(input.cloud.send).not.toHaveBeenCalled();
		}
	});

	it("rejects invalid image data before capture or publication", async () => {
		const input = fixture();
		input.draft.images = ["not an image"];
		await expect(prepareCloudHandoff(input)).rejects.toThrow();
		expect(helpers.inspect).not.toHaveBeenCalled();
	});
});
