import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { CloudSessionController } from "../../cloud/controller";
import * as git from "./git-preparation";
import { type PublishedHandoffInput, publishCloudHandoff } from "./publication";

afterEach(() => vi.restoreAllMocks());

function fixture() {
	const input: PublishedHandoffInput = {
		localGit: {
			id: "approved-preparation",
			root: tmpdir(),
			workspaceRelativePath: "packages/example",
			repoUrl: "https://github.com/example/project",
			remote: "origin",
			branch: "cline/handoff-12345678-abc",
			headSha: "a".repeat(40),
			treeSha: "b".repeat(40),
		},
		repoUrl: "https://github.com/example/project",
		branch: "cline/handoff-12345678-abc",
		workspaceRelativePath: "packages/example",
		requestId: "confirmed-attempt",
		organizationId: null,
		modelId: "model",
		initialMessage: { text: "Captured summary" },
		mode: "plan",
	};
	const controller = {
		prepareHandoffRepository: vi.fn(async () => ({
			organizationId: undefined,
		})),
		listModels: vi.fn(
			async (): ReturnType<CloudSessionController["listModels"]> => [
				{ id: "model", name: "Model", catalogId: "cline" },
			],
		),
		create: vi.fn(
			async (
				_input: Parameters<CloudSessionController["create"]>[0],
			): ReturnType<CloudSessionController["create"]> => ({
				sessionId: "cloud-session",
				status: "ready",
				initialSend: { dispatched: true, message: "Acceptance unconfirmed" },
			}),
		),
	};
	const apply = vi
		.spyOn(git, "applyHandoffGit")
		.mockResolvedValue("c".repeat(40));
	const verify = vi.spyOn(git, "verifyPublishedHandoffGit").mockResolvedValue();
	return { input, controller, apply, verify };
}

it.each([
	{ repoUrl: "https://github.com/example/other" },
	{ branch: "main" },
	{ workspaceRelativePath: "" },
])("rejects a direct caller's changed target before publication: %j", async (changed) => {
	const f = fixture();
	await expect(
		publishCloudHandoff({
			controller: f.controller,
			input: { ...f.input, ...changed },
			assertCurrent: () => {},
		}),
	).rejects.toThrow("Cloud workspace must match");
	expect(f.controller.prepareHandoffRepository).not.toHaveBeenCalled();
	expect(f.apply).not.toHaveBeenCalled();
	expect(f.controller.create).not.toHaveBeenCalled();
});

it("defaults direct publication to resumable and preserves creation options and uncertain delivery", async () => {
	const f = fixture();
	const result = await publishCloudHandoff({
		controller: f.controller,
		input: f.input,
		assertCurrent: () => {},
	});
	const { localGit, ...creation } = f.input;
	expect(f.apply).toHaveBeenCalledExactlyOnceWith(localGit);
	expect(f.verify).toHaveBeenCalledExactlyOnceWith(localGit, "c".repeat(40));
	expect(f.controller.create).toHaveBeenCalledExactlyOnceWith({
		...creation,
		sandboxType: "resumable",
	});
	expect(result).toEqual({
		sessionId: "cloud-session",
		status: "ready",
		initialSend: { dispatched: true, message: "Acceptance unconfirmed" },
	});
});

it("does not create when the host becomes stale during final Git verification", async () => {
	const f = fixture();
	let current = true;
	f.verify.mockImplementation(async () => {
		current = false;
	});
	await expect(
		publishCloudHandoff({
			controller: f.controller,
			input: f.input,
			assertCurrent: () => {
				if (!current) throw new Error("Host disposed");
			},
		}),
	).rejects.toThrow("Host disposed");
	expect(f.apply).toHaveBeenCalledOnce();
	expect(f.verify).toHaveBeenCalledOnce();
	expect(f.controller.create).not.toHaveBeenCalled();
});
