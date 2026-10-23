import { describe, expect, it, vi } from "vitest";
import {
	type ApprovalPolicy,
	asRemoteSessionId,
	DEFAULT_APPROVAL_POLICY,
} from "../session";
import { CloudLaunches } from "./cloud-launches";
import {
	type ConnectionSnapshot,
	SessionConnectionController,
} from "./controller";
import { type ConnectionDescriptor, descriptorKey } from "./endpoints";

const descriptor: ConnectionDescriptor = {
	mode: "cloud",
	url: "https://core.example/session/a",
	remoteSessionId: "a",
	pendingInitialMessage: "First prompt",
	allowInitialCreate: true,
};
function fixture() {
	const controller = new SessionConnectionController(descriptor);
	vi.spyOn(controller, "start").mockResolvedValue();
	let finish = () => {};
	vi.spyOn(controller, "sendInput").mockReturnValue(
		new Promise<void>((resolve) => {
			finish = resolve;
		}),
	);
	const dispose = vi.spyOn(controller, "dispose");
	const factory = vi.fn(() => controller);
	const launches = new CloudLaunches(factory);
	const save = vi.fn(async () => {});
	const input = { descriptor, message: "First prompt", deps: {}, save };
	return {
		controller,
		dispose,
		factory,
		launches,
		save,
		input,
		finish: () => finish(),
	};
}
describe("CloudLaunches", () => {
	it("bounds abandoned checkpoint forks before any screen acquires them", () => {
		const launches = new CloudLaunches();
		const entries = Array.from({ length: 10 }, (_, index) => {
			const descriptor: ConnectionDescriptor = {
				mode: "local",
				url: "ws://localhost:8080",
				hubSessionId: `fork-${index}`,
			};
			const controller = new SessionConnectionController(descriptor);
			const dispose = vi.spyOn(controller, "dispose");
			launches.retain(descriptor, controller);
			return { descriptor, controller, dispose };
		});
		expect(entries[0]!.dispose).toHaveBeenCalledOnce();
		expect(entries[1]!.dispose).toHaveBeenCalledOnce();
		for (const entry of entries.slice(2))
			expect(entry.dispose).not.toHaveBeenCalled();
		const newest = entries.at(-1)!;
		expect(launches.acquire(newest.descriptor)?.controller).toBe(
			newest.controller,
		);
		launches.clear();
	});
	it("marks live background activity unread and clears it on opening, deletion, and sign-out", async () => {
		const f = fixture();
		const opened = { ...descriptor, pendingInitialMessage: undefined };
		const key = descriptorKey(opened);
		let snapshot: ConnectionSnapshot = {
			...f.controller.getSnapshot(),
			status: { phase: "ready" },
			view: {
				...f.controller.getSnapshot().view,
				connectionStatus: "live",
				runStatus: "running",
			},
		};
		vi.spyOn(f.controller, "getSnapshot").mockImplementation(() => snapshot);
		let changed = () => {};
		vi.spyOn(f.controller, "subscribe").mockImplementation((listener) => {
			changed = listener;
			return () => {};
		});
		const lease = f.launches.open(opened);
		changed();
		expect(f.launches.getUnread().size).toBe(0);
		lease?.release();
		await Promise.resolve();
		const read = f.launches.getUnread();
		snapshot = {
			...snapshot,
			view: {
				...snapshot.view,
				messages: [
					{
						id: "answer",
						role: "assistant",
						origin: "live",
						blocks: [{ kind: "text", text: "Hello" }],
					},
				],
			},
		};
		changed();
		expect(f.launches.getUnread().has(key)).toBe(true);
		expect(read.size).toBe(0); // External-store snapshots are immutable.
		const notify = vi.fn();
		f.launches.subscribe(notify);
		changed();
		expect(notify).not.toHaveBeenCalled();
		const returned = f.launches.open(opened);
		expect(f.launches.getUnread().size).toBe(0);
		snapshot = {
			...snapshot,
			view: { ...snapshot.view, runStatus: "completed" },
		};
		changed();
		expect(f.launches.getUnread().size).toBe(0); // Visible activity stays read.
		returned?.release();
		snapshot = {
			...snapshot,
			view: { ...snapshot.view, runStatus: "running" },
		};
		changed();
		expect(f.launches.getUnread().has(key)).toBe(true);
		f.launches.reconcile([
			{
				id: asRemoteSessionId("a"),
				sandboxUrl: opened.url,
				expiredAt: null,
				status: "expired",
			},
		]);
		expect(f.launches.getUnread().has(key)).toBe(true); // Dropping a connection is not reading it.
		f.launches.remove(key);
		expect(f.launches.getUnread().size).toBe(0);
		f.launches.open(opened)?.release();
		changed();
		snapshot = {
			...snapshot,
			view: { ...snapshot.view, runStatus: "completed" },
		};
		changed();
		expect(f.launches.getUnread().has(key)).toBe(true);
		f.launches.clear();
		expect(f.launches.getUnread().size).toBe(0);
	});
	it("does not mark transport, hydration, or unchanged projected messages unread", async () => {
		const f = fixture();
		let snapshot = f.controller.getSnapshot();
		vi.spyOn(f.controller, "getSnapshot").mockImplementation(() => snapshot);
		let changed = () => {};
		vi.spyOn(f.controller, "subscribe").mockImplementation((listener) => {
			changed = listener;
			return () => {};
		});
		f.launches
			.open({ ...descriptor, pendingInitialMessage: undefined })
			?.release();
		for (const connectionStatus of [
			"hydrating",
			"live",
			"reconnecting",
			"hydrating",
			"live",
		] as const) {
			snapshot = {
				...snapshot,
				status: { phase: "ready" },
				view: {
					...snapshot.view,
					connectionStatus,
					messages: [
						{
							id: "history",
							role: "assistant",
							origin: "hydrated",
							blocks: [{ kind: "text", text: "Saved answer" }],
						},
					],
				},
			};
			changed();
			expect(f.launches.getUnread().size).toBe(0);
		}
		snapshot = {
			...snapshot,
			view: {
				...snapshot.view,
				messages: snapshot.view.messages.map((message) => ({ ...message })),
			},
		};
		changed();
		expect(f.launches.getUnread().size).toBe(0);
		f.launches.clear();
	});
	it("preserves failed sends when an opened controller fails", async () => {
		const f = fixture();
		const snapshot = f.controller.getSnapshot();
		vi.spyOn(f.controller, "getSnapshot").mockReturnValue({
			...snapshot,
			status: { phase: "error" },
			view: {
				...snapshot.view,
				messages: [
					{
						id: "failed",
						role: "user",
						origin: "live",
						blocks: [],
						failed: true,
					},
				],
			},
		});
		const opened = { ...descriptor, pendingInitialMessage: undefined };
		f.launches.open(opened)?.release();
		await Promise.resolve();
		expect(f.dispose).not.toHaveBeenCalled();
		expect(f.launches.open(opened)?.controller).toBe(f.controller);
		expect(f.controller.sendInput).not.toHaveBeenCalled();
		f.launches.clear();
	});
	it.each([
		"expired",
		"failed",
		"stopped",
		"suspended",
	] as const)("reopens a retained %s workspace through a fresh controller", async (status) => {
		const f = fixture();
		const opened = { ...descriptor, pendingInitialMessage: undefined };
		const row = {
			id: asRemoteSessionId("a"),
			sandboxUrl: descriptor.url,
			expiredAt: null,
			status,
		};
		const lease = f.launches.open(opened)!;
		f.launches.reconcile([row]);
		expect(f.dispose).not.toHaveBeenCalled();
		lease.release();
		await Promise.resolve();
		f.launches.reconcile([]);
		f.launches.reconcile([{ ...row, status: "running" }]);
		f.launches.reconcile([{ ...row, organizationId: "other" }]);
		expect(f.dispose).not.toHaveBeenCalled();
		f.launches.reconcile([row]);
		expect(f.dispose).toHaveBeenCalledOnce();
		expect(f.launches.acquire(opened)).toBeUndefined();
		const replacement = new SessionConnectionController(opened);
		f.factory.mockReturnValueOnce(replacement);
		const reopened = f.launches.open(opened);
		expect(reopened?.controller).toBe(replacement);
		reopened?.release();
		expect(f.factory).toHaveBeenCalledTimes(2);
		expect(f.controller.sendInput).not.toHaveBeenCalled();
	});
	it("retains opened controllers and publishes only live status changes", async () => {
		const f = fixture();
		const opened = { ...descriptor, pendingInitialMessage: undefined };
		let snapshot: ConnectionSnapshot = {
			...f.controller.getSnapshot(),
			status: { phase: "ready" },
			view: {
				...f.controller.getSnapshot().view,
				connectionStatus: "live",
				runStatus: "running",
			},
		};
		vi.spyOn(f.controller, "getSnapshot").mockImplementation(() => snapshot);
		let changed = () => {};
		vi.spyOn(f.controller, "subscribe").mockImplementation((listener) => {
			changed = listener;
			return () => {};
		});
		const notify = vi.fn();
		f.launches.subscribe(notify);
		const lease = f.launches.open(opened)!;
		changed();
		expect(f.launches.getStatuses()[descriptorKey(opened)]).toBe("running");
		const statuses = f.launches.getStatuses();
		changed(); // Text delta, unchanged status: no sidebar render.
		expect(f.launches.getStatuses()).toBe(statuses);
		expect(notify).toHaveBeenCalledOnce();
		lease.release();
		await Promise.resolve();
		snapshot = {
			...snapshot,
			view: { ...snapshot.view, runStatus: "completed" },
		};
		changed();
		expect(f.launches.getStatuses()[descriptorKey(opened)]).toBe("completed");
		expect(f.dispose).not.toHaveBeenCalled();
		expect(f.launches.open(opened)?.controller).toBe(lease.controller);
		expect(f.factory).toHaveBeenCalledOnce();
		expect(f.controller.sendInput).not.toHaveBeenCalled();
		snapshot = {
			...snapshot,
			view: { ...snapshot.view, connectionStatus: "reconnecting" },
		};
		changed();
		expect(f.launches.getStatuses()).toEqual({});
		f.launches.clear();
		expect(f.dispose).toHaveBeenCalledOnce();
	});
	it("does not retain explicit-new Cloud or unsent legacy launch controllers", () => {
		const f = fixture();
		expect(
			f.launches.open(descriptor, { createNewSession: true }),
		).toBeUndefined();
		expect(f.launches.open(descriptor)).toBeUndefined();
		expect(f.factory).not.toHaveBeenCalled();
	});
	it.each([
		"authToken",
		"organizationId",
		"remoteSessionId",
		"apiBaseUrl",
	] as const)("retires the connection when %s changes", async (field) => {
		const f = fixture();
		const opened = { ...descriptor, pendingInitialMessage: undefined };
		f.launches.open(opened)?.release();
		await Promise.resolve();
		f.launches.open({ ...opened, [field]: "changed" });
		expect(f.dispose).toHaveBeenCalledOnce();
		expect(f.factory).toHaveBeenCalledTimes(2);
		f.launches.clear();
	});
	it("bounds idle retained controllers without evicting active work", async () => {
		const controllers: SessionConnectionController[] = [];
		const launches = new CloudLaunches((d) => {
			const controller = new SessionConnectionController(d);
			controllers.push(controller);
			vi.spyOn(controller, "dispose");
			if (controllers.length === 1) {
				const snapshot = controller.getSnapshot();
				vi.spyOn(controller, "getSnapshot").mockReturnValue({
					...snapshot,
					view: { ...snapshot.view, runStatus: "running" },
				});
			}
			return controller;
		});
		for (let i = 0; i < 10; i++) {
			launches
				.open({ mode: "cloud", url: `https://core/session/${i}` })
				?.release();
			await Promise.resolve();
		}
		expect(controllers[0]!.dispose).not.toHaveBeenCalled();
		expect(controllers[1]!.dispose).toHaveBeenCalledOnce();
		expect(controllers[2]!.dispose).toHaveBeenCalledOnce();
		expect(controllers[3]!.dispose).not.toHaveBeenCalled();
		launches.clear();
		expect(launches.getStatuses()).toEqual({});
	});
	it("applies policy changes while connection setup is still pending", async () => {
		const f = fixture();
		let connected = () => {};
		vi.mocked(f.controller.start).mockReturnValue(
			new Promise<void>((resolve) => {
				connected = resolve;
			}),
		);
		let update: ((policy: ApprovalPolicy) => void) | undefined;
		const stop = vi.fn();
		const changed = vi.spyOn(f.controller, "setApprovalPolicy");
		const starting = f.launches.start({
			...f.input,
			subscribePolicy: (listener) => {
				update = listener;
				return stop;
			},
		});
		update?.(DEFAULT_APPROVAL_POLICY);
		expect(changed).toHaveBeenCalledWith(DEFAULT_APPROVAL_POLICY);
		connected();
		await starting;
		f.launches.clear();
		expect(stop).toHaveBeenCalledOnce();
	});
	it("does not send after sign-out during the durable clear", async () => {
		const f = fixture();
		let saved = () => {};
		f.save.mockReturnValue(
			new Promise<void>((resolve) => {
				saved = resolve;
			}),
		);
		const starting = f.launches.start(f.input);
		await Promise.resolve();
		expect(f.save).toHaveBeenCalledOnce();
		f.launches.clear();
		saved();
		await expect(starting).rejects.toThrow("cancelled");
		expect(f.controller.sendInput).not.toHaveBeenCalled();
	});
	it("retains a failed send for explicit retry, without resending", async () => {
		const f = fixture();
		const snapshot = f.controller.getSnapshot();
		vi.spyOn(f.controller, "getSnapshot").mockReturnValue({
			...snapshot,
			view: {
				...snapshot.view,
				messages: [
					{ id: "u1", role: "user", origin: "live", blocks: [], failed: true },
				],
			},
		});
		await f.launches.start(f.input);
		f.launches.acquire(descriptor)?.release();
		f.finish();
		await Promise.resolve();
		await Promise.resolve();
		expect(f.dispose).not.toHaveBeenCalled();
		expect(f.controller.sendInput).toHaveBeenCalledOnce();
		f.launches.clear();
	});
	it("sends without a screen and reuses the same connection without resending", async () => {
		const f = fixture();
		const attachments = { userImages: ["data:image/jpeg;base64,/9j/"] };
		const ready = await f.launches.start({ ...f.input, attachments });
		expect(ready.pendingInitialMessage).toBeUndefined();
		expect(f.save).toHaveBeenCalledWith(
			expect.not.objectContaining({ pendingInitialMessage: expect.anything() }),
		);
		expect(f.controller.sendInput).toHaveBeenCalledExactlyOnceWith(
			"First prompt",
			attachments,
		);
		const first = f.launches.acquire(ready);
		expect(first?.controller).toBe(f.controller);
		first?.release();
		await Promise.resolve();
		expect(f.dispose).not.toHaveBeenCalled();
		const returned = f.launches.acquire(ready);
		expect(returned?.controller).toBe(f.controller);
		expect(f.factory).toHaveBeenCalledOnce();
		expect(f.controller.sendInput).toHaveBeenCalledOnce();
		f.finish();
		await Promise.resolve();
		expect(f.dispose).not.toHaveBeenCalled();
		returned?.release();
		await Promise.resolve();
		expect(f.dispose).toHaveBeenCalledOnce();
	});
	it("retains an unopened result until the user returns", async () => {
		const f = fixture();
		await f.launches.start(f.input);
		f.finish();
		await Promise.resolve();
		await Promise.resolve();
		expect(f.dispose).not.toHaveBeenCalled();
		expect(f.launches.acquire(descriptor)?.controller).toBe(f.controller);
		f.launches.clear();
	});
	it("does not dispatch when durable resend intent cannot be cleared", async () => {
		const f = fixture();
		f.save.mockRejectedValue(new Error("Keychain unavailable"));
		await expect(f.launches.start(f.input)).rejects.toThrow(
			"Keychain unavailable",
		);
		expect(f.controller.sendInput).not.toHaveBeenCalled();
		expect(f.dispose).toHaveBeenCalledOnce();
		expect(f.launches.acquire(descriptor)).toBeUndefined();
	});
	it("does not send after sign-out during connection setup", async () => {
		const f = fixture();
		let connected = () => {};
		vi.mocked(f.controller.start).mockReturnValue(
			new Promise<void>((resolve) => {
				connected = resolve;
			}),
		);
		const starting = f.launches.start(f.input);
		f.launches.clear();
		connected();
		await expect(starting).rejects.toThrow("cancelled");
		expect(f.controller.sendInput).not.toHaveBeenCalled();
		expect(f.save).not.toHaveBeenCalled();
	});
	it("rejects a duplicate launch instead of dispatching twice", async () => {
		const f = fixture();
		await f.launches.start(f.input);
		await expect(f.launches.start(f.input)).rejects.toThrow("already starting");
		expect(f.controller.sendInput).toHaveBeenCalledOnce();
		f.launches.clear();
	});
});
