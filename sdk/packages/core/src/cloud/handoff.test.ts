import { describe, expect, it, vi } from "vitest";
import { CloudHandoffTranscriptMismatchError } from "../services/cloud-handoff";
import { CloudHandoffSeedRejectedError } from "./controller";
import {
	CloudHandoffCoordinator,
	type CloudHandoffCoordinatorOptions,
	type CloudHandoffSourceSnapshot,
} from "./handoff";

function fixture() {
	const state: CloudHandoffSourceSnapshot = {
		sessionId: "local",
		cwd: "/repo",
		modelId: "model",
		mode: "plan",
		config: { autoApproveTools: false, thinking: true },
		metadata: {},
		messages: [
			{ role: "user", content: [{ type: "text", text: "continue my work" }] },
		],
		busy: false,
		queued: false,
	};
	let locked = false;
	const release = vi.fn(() => {
		locked = false;
	});
	const cloud = {
		prepareHandoffRepository: vi.fn(async () => ({
			organizationId: undefined,
		})),
		handoffTargetExists: vi.fn(async () => true),
		waitUntilReady: vi.fn(async () => {}),
		create: vi.fn<CloudHandoffCoordinatorOptions["cloud"]["create"]>(
			async (input) => {
				await input.handoff!.onCreating?.();
				await input.handoff!.onOuterSessionCreated("outer", { created: true });
				await input.handoff!.resolveMessages();
				await input.handoff!.onSeeding?.();
				return { sessionId: "outer" } as Awaited<
					ReturnType<CloudHandoffCoordinatorOptions["cloud"]["create"]>
				>;
			},
		),
		seedHandoff: vi.fn(async (_id, seed) => {
			await seed.onSeeding?.();
			return { innerSessionId: "inner" };
		}),
		verifyHandoffTranscript: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
	};
	const options: CloudHandoffCoordinatorOptions = {
		source: {
			read: vi.fn(async () => structuredClone(state)),
			lock: () => {
				if (locked) throw new Error("locked");
				locked = true;
				return release;
			},
			updateMetadata: vi.fn(async (_id, metadata) => {
				state.metadata = metadata;
			}),
		},
		cloud,
		scopeKey: "account",
		appBaseUrl: "https://app.cline.bot",
		assertAvailable: vi.fn(),
		onProgress: vi.fn(),
		recoverCreation: vi.fn(async () => undefined),
		models: vi.fn(async () => [
			{ id: "model", name: "Model", catalogId: "cline-cloud" as const },
		]),
		preflight: vi.fn(async () => ({
			repoUrl: "https://github.com/cline/test",
			branch: "main",
			headSha: "abc123",
			remoteName: "origin",
			workspaceRelativePath: "subdir",
		})),
	};
	const coordinator = new CloudHandoffCoordinator(options);
	return { coordinator, options, cloud, state, release };
}

describe("shared cloud handoff transaction", () => {
	it("persists recovery before seeding, verifies history, then marks complete", async () => {
		const f = fixture();
		f.cloud.verifyHandoffTranscript.mockImplementation(async () => {
			expect(f.state.metadata.handoff).toMatchObject({
				status: "pending",
				toCloudSessionId: "outer",
			});
			expect(f.state.metadata.cloudHandoffSeedDispatched).toBe(true);
		});
		const prepared = await f.coordinator.prepare();
		expect(await f.coordinator.execute(prepared)).toBe("outer");
		expect(f.state.metadata.handoff).toMatchObject({
			status: "complete",
			fingerprint: prepared.fingerprint,
		});
		expect(f.cloud.create.mock.calls[0][0]).toMatchObject({
			autoApproveTools: false,
			thinking: true,
			mode: "plan",
			workspaceRelativePath: "subdir",
		});
		expect(f.release).toHaveBeenCalledOnce();
	});
	it.each([
		"busy",
		"queued",
	] as const)("blocks %s sources without provisioning", async (key) => {
		const f = fixture();
		f.state[key] = true;
		await expect(f.coordinator.prepare()).rejects.toThrow();
		expect(f.cloud.create).not.toHaveBeenCalled();
	});
	it("revalidates the prepared branch before provisioning", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		vi.mocked(f.options.preflight!).mockResolvedValue({
			repoUrl: "https://github.com/cline/test",
			branch: "changed",
			headSha: "abc123",
			remoteName: "origin",
		});
		await expect(f.coordinator.execute(prepared)).rejects.toThrow("changed");
		expect(f.cloud.create).not.toHaveBeenCalled();
		expect(f.release).toHaveBeenCalledOnce();
	});
	it("rejects an unavailable source model before provisioning", async () => {
		const f = fixture();
		f.options.models = vi.fn(async () => []);
		await expect(f.coordinator.prepare()).rejects.toThrow(
			"selected cloud model is no longer available",
		);
		expect(f.cloud.create).not.toHaveBeenCalled();
	});
	it("rejects a changed pinned model before provisioning", async () => {
		const f = fixture();
		await expect(f.coordinator.prepare("other-model")).rejects.toThrow(
			"source model changed",
		);
		expect(f.cloud.create).not.toHaveBeenCalled();
	});
	it("refuses a stale account confirmation", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		await expect(
			f.coordinator.execute({ ...prepared, scopeKey: "other" }),
		).rejects.toThrow("account");
		expect(f.cloud.create).not.toHaveBeenCalled();
	});
	it("never repeats an ambiguous outer create after restart", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.create.mockImplementationOnce(async (input) => {
			await input.handoff!.onCreating?.();
			throw new Error("response lost");
		});
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"response lost",
		);
		const restarted = new CloudHandoffCoordinator(f.options);
		await expect(restarted.execute(prepared)).rejects.toThrow(
			"unconfirmed outcome",
		);
		expect(f.cloud.create).toHaveBeenCalledOnce();
		expect(f.options.recoverCreation).toHaveBeenCalledOnce();
	});
	it("recovers an outer create by request identity and uses that workspace", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.state.metadata = {
			cloudHandoffScope: "account",
			cloudHandoffIntent: {
				fingerprint: prepared.fingerprint,
				config: f.state.config,
			},
		};
		vi.mocked(f.options.recoverCreation).mockResolvedValue("recovered");
		expect(await f.coordinator.execute(prepared)).toBe("recovered");
		expect(f.cloud.create).not.toHaveBeenCalled();
		expect(f.cloud.seedHandoff).toHaveBeenCalledOnce();
	});
	it("resumes an interrupted seed with recoverOnly, preserving manual approvals", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.verifyHandoffTranscript.mockRejectedValueOnce(
			new Error("connection lost"),
		);
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"connection lost",
		);
		expect(await new CloudHandoffCoordinator(f.options).execute(prepared)).toBe(
			"outer",
		);
		expect(f.cloud.seedHandoff).toHaveBeenCalledWith(
			"outer",
			expect.objectContaining({
				recoverOnly: true,
				config: { autoApproveTools: false, thinking: true },
			}),
		);
		expect(f.cloud.create).toHaveBeenCalledOnce();
	});
	it("preserves pending workspace on transient verification failure", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.verifyHandoffTranscript.mockRejectedValue(
			new Error("disconnected"),
		);
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"disconnected",
		);
		expect(f.state.metadata.handoff).toMatchObject({ status: "pending" });
		expect(f.cloud.delete).not.toHaveBeenCalled();
	});
	it("cleans a definitely invalid new transcript, never a resumed target", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.verifyHandoffTranscript.mockRejectedValue(
			new CloudHandoffTranscriptMismatchError(1, 0),
		);
		await expect(f.coordinator.execute(prepared)).rejects.toThrow();
		expect(f.cloud.delete).toHaveBeenCalledWith("outer");
		expect(f.state.metadata.handoff).toBeUndefined();
		f.state.metadata = {
			handoff: {
				status: "pending",
				toCloudSessionId: "old",
				handedOffAt: "date",
				fingerprint: prepared.fingerprint,
			},
		};
		await expect(f.coordinator.execute(prepared)).rejects.toThrow();
		expect(f.cloud.delete).toHaveBeenCalledOnce();
	});
	it("keeps the source pending if its history changes during transfer", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.verifyHandoffTranscript.mockImplementation(async () => {
			f.state.messages.push({ role: "user", content: "new message" });
		});
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"conversation changed",
		);
		expect(f.state.metadata.handoff).toMatchObject({ status: "pending" });
	});
	it("does not provision if durable recovery metadata cannot be written", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		vi.mocked(f.options.source.updateMetadata).mockRejectedValue(
			new Error("disk full"),
		);
		await expect(f.coordinator.execute(prepared)).rejects.toThrow("disk full");
		expect(f.cloud.verifyHandoffTranscript).not.toHaveBeenCalled();
	});
	it("does not leave an unknown-create marker when pre-dispatch discovery fails", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.create.mockRejectedValueOnce(new Error("list unavailable"));
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"list unavailable",
		);
		expect(f.state.metadata.cloudHandoffIntent).toBeUndefined();
		expect(await f.coordinator.execute(prepared)).toBe("outer");
	});

	it("retains the target but clears a rejected seed marker even after access is revoked", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.create.mockImplementationOnce(async (input) => {
			await input.handoff!.onCreating?.();
			await input.handoff!.onOuterSessionCreated("outer", { created: true });
			await input.handoff!.onSeeding?.();
			vi.mocked(f.options.assertAvailable).mockImplementation(() => {
				throw new Error("access revoked");
			});
			throw new CloudHandoffSeedRejectedError(
				new Error("cancelled before dispatch"),
			);
		});
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"cancelled before dispatch",
		);
		expect(f.state.metadata.cloudHandoffSeedDispatched).toBeUndefined();
		expect(f.state.metadata.handoff).toMatchObject({
			toCloudSessionId: "outer",
			status: "pending",
		});
		expect(f.cloud.delete).not.toHaveBeenCalled();
		vi.mocked(f.options.assertAvailable).mockReset();
		expect(await f.coordinator.execute(prepared)).toBe("outer");
		expect(f.cloud.seedHandoff.mock.calls[0][1].recoverOnly).toBe(false);
	});

	it("clears recovery intent on a definite rejected create, allowing a retry", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.create.mockImplementationOnce(async (input) => {
			await input.handoff!.onCreating?.();
			const error = new Error("create rejected");
			error.name = "CloudHandoffCreationRejectedError";
			throw error;
		});
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"create rejected",
		);
		expect(f.state.metadata.cloudHandoffIntent).toBeUndefined();
		expect(await f.coordinator.execute(prepared)).toBe("outer");
	});

	it("rejects changed approval settings during confirmation and recovery", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.state.config.autoApproveTools = true;
		await expect(f.coordinator.execute(prepared)).rejects.toThrow("changed");
		expect(f.cloud.create).not.toHaveBeenCalled();
		f.state.metadata = {
			cloudHandoffIntent: {
				fingerprint: prepared.fingerprint,
				config: prepared.config,
			},
		};
		await expect(
			f.coordinator.execute(await f.coordinator.prepare()),
		).rejects.toThrow("unresolved");
		expect(f.cloud.create).not.toHaveBeenCalled();
	});
	it("binds an adopted workspace to the account and source settings before seeding", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.create.mockImplementationOnce(async (input) => {
			await input.handoff!.onOuterSessionCreated("adopted", { created: false });
			expect(f.state.metadata.cloudHandoffScope).toBe("account");
			expect(f.state.metadata.cloudHandoffIntent).toMatchObject({
				config: prepared.config,
			});
			await input.handoff!.resolveMessages();
			return { sessionId: "adopted" } as Awaited<
				ReturnType<CloudHandoffCoordinatorOptions["cloud"]["create"]>
			>;
		});
		f.cloud.verifyHandoffTranscript.mockRejectedValue(
			new CloudHandoffTranscriptMismatchError(1, 0),
		);
		await expect(f.coordinator.execute(prepared)).rejects.toThrow();
		expect(f.cloud.delete).not.toHaveBeenCalled();
	});
	it("clears a definitely rejected intent even after rollout access is revoked", async () => {
		const f = fixture();
		const prepared = await f.coordinator.prepare();
		f.cloud.create.mockImplementationOnce(async (input) => {
			await input.handoff!.onCreating?.();
			vi.mocked(f.options.assertAvailable).mockImplementation(() => {
				throw new Error("flag off");
			});
			const error = new Error("create rejected");
			error.name = "CloudHandoffCreationRejectedError";
			throw error;
		});
		await expect(f.coordinator.execute(prepared)).rejects.toThrow(
			"create rejected",
		);
		expect(f.state.metadata.cloudHandoffIntent).toBeUndefined();
		expect(f.cloud.delete).not.toHaveBeenCalled();
	});
});
