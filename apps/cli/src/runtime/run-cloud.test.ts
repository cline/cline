import { afterEach, describe, expect, it, vi } from "vitest";

const {
	client,
	dispose,
	emitJsonLine,
	writeErr,
	readGitOriginUrl,
	readRepoStatus,
} = vi.hoisted(() => ({
	client: {
		listRepositories: vi.fn(),
		listBranches: vi.fn(),
		listModels: vi.fn(),
		create: vi.fn(),
		send: vi.fn(),
		abort: vi.fn(),
		subscribe: vi.fn(),
	},
	dispose: vi.fn(async () => {}),
	emitJsonLine: vi.fn(),
	writeErr: vi.fn(),
	readGitOriginUrl: vi.fn(),
	readRepoStatus: vi.fn(),
}));

vi.mock("@cline/core", () => ({ readCloudModelIdGlobally: () => undefined }));

vi.mock("../utils/output", () => ({
	c: { dim: "", reset: "" },
	emitJsonLine,
	writeErr,
	writeln: vi.fn(),
}));

vi.mock("../utils/repo-status", async (importOriginal) => ({
	...(await importOriginal<typeof import("../utils/repo-status")>()),
	readGitOriginUrl,
	readRepoStatus,
}));

vi.mock("./interactive/cloud-sessions", () => ({
	createCliCloudSessions: () => ({ client, dispose }),
	cloudSessionUrl: (id: string) =>
		`https://app.cline.bot/agents?sessionId=${id}`,
	resolveCloudModel: (models: unknown[]) => models[0],
}));

import { runCloud } from "./run-cloud";

const repo = {
	id: 7,
	name: "test",
	fullName: "acme/test",
	url: "https://github.com/acme/test",
	defaultBranch: "main",
};

function setup() {
	readGitOriginUrl.mockResolvedValue("git@github.com:acme/test.git");
	readRepoStatus.mockResolvedValue({ branch: "feature", diffStats: null });
	client.listRepositories.mockResolvedValue({
		connected: true,
		connectUrl: "https://app.cline.bot/connect",
		repositories: [repo],
	});
	client.listModels.mockResolvedValue([{ id: "m1", name: "Model 1" }]);
	client.create.mockResolvedValue({ sessionId: "ses-1" });
}

const run = (extra: { branch?: string } = {}) =>
	runCloud({
		prompt: "fix the bug",
		cwd: "/repo",
		workspaceRoot: "/repo",
		providerId: "cline",
		outputMode: "json",
		...extra,
	});

describe("runCloud", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("exits once the prompt is accepted while the turn keeps running", async () => {
		setup();
		client.listBranches
			.mockResolvedValueOnce({ branches: ["feature-x"], nextToken: "page-2" })
			.mockResolvedValueOnce({ branches: ["feature"] });
		let listener: ((event: unknown) => void) | undefined;
		client.subscribe.mockImplementation((next) => {
			listener = next;
			return () => {};
		});
		client.send.mockImplementation(() => {
			queueMicrotask(() =>
				listener?.({ type: "prompt_accepted", sessionId: "ses-1" }),
			);
			return new Promise(() => {});
		});

		expect(await run()).toBe(0);
		expect(client.listBranches).toHaveBeenLastCalledWith(7, {
			query: "feature",
			cursor: "page-2",
		});
		expect(client.create).toHaveBeenCalledWith(
			expect.objectContaining({ branch: "feature", modelId: "m1" }),
		);
		expect(emitJsonLine).toHaveBeenCalledWith(
			"stdout",
			expect.objectContaining({
				type: "cloud_dispatched",
				sessionId: "ses-1",
				repository: "acme/test",
				branch: "feature",
			}),
		);
		expect(client.abort).not.toHaveBeenCalled();
		expect(dispose).toHaveBeenCalled();
	});

	it("rejects a --branch that GitHub doesn't have before creating a session", async () => {
		setup();
		client.listBranches.mockResolvedValue({ branches: [] });

		expect(await run({ branch: "typo" })).toBe(1);
		expect(writeErr).toHaveBeenCalledWith(
			'--cloud: branch "typo" doesn\'t exist in acme/test.',
		);
		expect(client.create).not.toHaveBeenCalled();
	});

	it("reports a rejected send", async () => {
		setup();
		client.listBranches.mockResolvedValue({ branches: [] });
		client.subscribe.mockReturnValue(() => {});
		client.send.mockRejectedValue(
			new Error('CLOUD_SESSION_ERROR:{"code":"x","message":"sandbox failed"}'),
		);

		expect(await run()).toBe(1);
		expect(client.create).toHaveBeenCalledWith(
			expect.objectContaining({ branch: "main" }),
		);
		expect(writeErr).toHaveBeenCalledWith("--cloud: sandbox failed");
		expect(emitJsonLine).not.toHaveBeenCalled();
	});
});
