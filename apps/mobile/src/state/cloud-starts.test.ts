import { describe, expect, it, vi } from "vitest";
import { AmbiguousCloudSessionCreateError } from "@/cloud/rest/CloudSessionGateway";
import type { ConnectionDescriptor } from "@/connection";
import { CloudStartStore } from "./cloud-starts";
import type { CloudExecutionTarget } from "./execution-target-store";

const TARGET: CloudExecutionTarget = {
	id: "cloud-target",
	mode: "cloud",
	repoUrl: "https://github.com/cline/cline.git",
	label: "cline/cline",
	modelId: "cline/default",
};

const DESCRIPTOR: ConnectionDescriptor = {
	mode: "cloud",
	url: "https://core.example/api/v1/session/one",
	remoteSessionId: "one",
};

describe("CloudStartStore", () => {
	it("launches exactly once without any mounted observer", async () => {
		const store = new CloudStartStore();
		const launch = vi.fn(
			async (descriptor: ConnectionDescriptor) => descriptor,
		);
		const id = store.start({
			target: TARGET,
			message: "first",
			provision: async () => DESCRIPTOR,
			launch,
		});
		store.bindDescriptor(id, DESCRIPTOR);
		await vi.waitFor(() =>
			expect(store.getSnapshot()[0]).toMatchObject({
				phase: "ready",
				submitted: true,
			}),
		);
		expect(launch).toHaveBeenCalledExactlyOnceWith(DESCRIPTOR);
		expect(store.jobForDescriptor(DESCRIPTOR)?.id).toBe(id);
		store.retry(id);
		expect(launch).toHaveBeenCalledOnce();
	});
	it("never launches a provisioning job cleared by sign-out", async () => {
		const store = new CloudStartStore();
		let finish = (_descriptor: ConnectionDescriptor) => {};
		const launch = vi.fn(
			async (descriptor: ConnectionDescriptor) => descriptor,
		);
		store.start({
			target: TARGET,
			message: "first",
			provision: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			launch,
		});
		store.clear();
		finish(DESCRIPTOR);
		await Promise.resolve();
		expect(launch).not.toHaveBeenCalled();
		expect(store.getSnapshot()).toEqual([]);
	});
	it("never retries an ambiguous create and retains the draft for checking sessions", async () => {
		const store = new CloudStartStore();
		const provision = vi.fn(async () => {
			throw new AmbiguousCloudSessionCreateError();
		});
		const id = store.start({ target: TARGET, message: "keep me", provision });
		await Promise.resolve();
		await vi.waitFor(() =>
			expect(store.getSnapshot()[0]).toMatchObject({
				phase: "error",
				message: "keep me",
				recovery: "check-sessions",
			}),
		);
		store.retry(id);
		await Promise.resolve();
		expect(provision).toHaveBeenCalledTimes(1);
	});
	it("reports background progress without replacing another job", async () => {
		const store = new CloudStartStore();
		store.start({
			target: TARGET,
			message: "first",
			provision: async (onProgress) => {
				onProgress({ status: "provisioning", phase: "cloning_repository" });
				return new Promise(() => {});
			},
		});
		expect(store.getSnapshot()[0]).toMatchObject({
			phase: "provisioning",
			progress: { phase: "cloning_repository" },
		});
	});
	it("runs independent jobs without replacing or serialising either one", async () => {
		const store = new CloudStartStore();
		let finishFirst: ((value: ConnectionDescriptor) => void) | undefined;
		const first = new Promise<ConnectionDescriptor>((resolve) => {
			finishFirst = resolve;
		});
		store.start({ target: TARGET, message: "first", provision: () => first });
		store.start({
			target: { ...TARGET, id: "two", label: "cline/docs" },
			message: "second",
			provision: async () => ({ ...DESCRIPTOR, remoteSessionId: "two" }),
		});
		await Promise.resolve();
		expect(store.getSnapshot().map((job) => job.phase)).toEqual([
			"provisioning",
			"ready",
		]);
		finishFirst?.(DESCRIPTOR);
		await Promise.resolve();
		expect(store.getSnapshot().map((job) => job.phase)).toEqual([
			"ready",
			"ready",
		]);
	});

	it("keeps a failed prompt scoped to its retryable job", async () => {
		const store = new CloudStartStore();
		const provision = vi
			.fn<() => Promise<ConnectionDescriptor>>()
			.mockRejectedValueOnce(new Error("provision failed"))
			.mockResolvedValueOnce(DESCRIPTOR);
		const id = store.start({ target: TARGET, message: "keep me", provision });
		await Promise.resolve();
		await vi.waitFor(() =>
			expect(store.getSnapshot()[0]).toMatchObject({
				phase: "error",
				message: "keep me",
				error: "provision failed",
			}),
		);
		store.retry(id);
		await Promise.resolve();
		expect(store.getSnapshot()[0]?.phase).toBe("ready");
	});
});
