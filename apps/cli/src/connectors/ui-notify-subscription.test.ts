import type { HubUIClient } from "@cline/core";
import type { HubUINotifyPayload } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

import {
	type NotifyDeliveryOptions,
	startUiNotifyDelivery,
	type UiNotifyClient,
} from "./ui-notify-subscription";

type Handlers = { onNotify?: (payload: HubUINotifyPayload) => void };

function fakeClient() {
	let handlers: Handlers = {};
	let unsubscribed = 0;
	return {
		client: {
			connect: async () => undefined,
			subscribeUI: (h: Handlers) => {
				handlers = h;
				return () => {
					unsubscribed += 1;
				};
			},
			close: () => undefined,
			dispose: async () => undefined,
		},
		emit(payload: unknown) {
			handlers.onNotify?.(payload as HubUINotifyPayload);
		},
		get unsubscribed() {
			return unsubscribed;
		},
	};
}

describe("startUiNotifyDelivery", () => {
	it("delivers to the thread bound to the notification's workspace", async () => {
		const fake = fakeClient();
		const deliver = vi.fn<(threadKey: string, text: string) => Promise<void>>(
			async () => undefined,
		);
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver,
		});

		fake.emit({
			title: "Ready for review",
			body: "Card — app",
			source: { workspacePath: "/code/app" },
		});
		await subscription.flush();

		expect(deliver).toHaveBeenCalledTimes(1);
		expect(deliver.mock.calls[0][0]).toBe("t1");
		expect(deliver.mock.calls[0][1]).toContain("Ready for review");
	});

	// The guarantee that makes this safe to turn on: an event we cannot place goes nowhere.
	it("delivers nothing when no thread is bound to that workspace", async () => {
		const fake = fakeClient();
		const deliver = vi.fn<(threadKey: string, text: string) => Promise<void>>(
			async () => undefined,
		);
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver,
		});

		fake.emit({
			title: "x",
			body: "y",
			source: { workspacePath: "/code/elsewhere" },
		});
		await subscription.flush();
		expect(deliver).not.toHaveBeenCalled();
	});

	// A connector that dies because a notification could not be posted is worse than one that
	// misses the notification: the first takes the conversation down with it.
	it("survives a delivery that throws", async () => {
		const fake = fakeClient();
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async () => {
				throw new Error("telegram is down");
			},
		});

		fake.emit({
			title: "x",
			body: "y",
			source: { workspacePath: "/code/app" },
		});
		await expect(subscription.flush()).resolves.toBeUndefined();
	});

	it("survives a malformed event instead of crashing the connector", async () => {
		const fake = fakeClient();
		const deliver = vi.fn<(threadKey: string, text: string) => Promise<void>>(
			async () => undefined,
		);
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver,
		});

		fake.emit(null);
		fake.emit("not an object");
		fake.emit({ source: { workspacePath: "/code/app" } });
		await subscription.flush();
		expect(deliver).not.toHaveBeenCalled();
	});
});

describe("UiNotifyClient", () => {
	// Kanban offers the step still missing to close a finished card. Only actions this connector
	// can route become buttons; anything else would be a button to nowhere.
	it("passes closing actions through, and drops ones it cannot route", async () => {
		const fake = fakeClient();
		const deliver = vi.fn<
			(
				threadKey: string,
				text: string,
				options: NotifyDeliveryOptions,
			) => Promise<void>
		>(async () => undefined);
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/repo" } } }),
			deliver,
		});

		fake.emit({
			title: "Ready for review",
			body: "Ajuste os links — work-os",
			source: { workspacePath: "/repo", itemId: "52609" },
			actions: [
				{ id: "integrate", label: "Integrar na main" },
				{ id: "rm -rf", label: "x" },
				{ id: "push", label: "  " },
				{
					id: "done",
					label: "Concluir",
					confirm: "1 commit não integrado será descartado.",
				},
			],
		});
		await subscription.flush();

		expect(deliver.mock.calls[0]?.[2].actions).toEqual([
			{ id: "integrate", label: "Integrar na main" },
			{
				id: "done",
				label: "Concluir",
				confirm: "1 commit não integrado será descartado.",
			},
		]);
	});

	it("carries no actions when none were offered", async () => {
		const fake = fakeClient();
		const deliver = vi.fn<
			(
				threadKey: string,
				text: string,
				options: NotifyDeliveryOptions,
			) => Promise<void>
		>(async () => undefined);
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/repo" } } }),
			deliver,
		});

		fake.emit({
			title: "Ready for review",
			body: "x",
			source: { workspacePath: "/repo" },
		});
		await subscription.flush();

		expect(deliver.mock.calls[0]?.[2].actions).toBeUndefined();
	});

	it("is satisfied by the real HubUIClient", () => {
		// The first version of this module declared a `subscribe` method that HubUIClient does
		// not have, and a cast hid it: every unit test passed against a fake with the invented
		// shape, and the running connector died with "client.subscribe is not a function".
		// This assignment is the check that was missing -- it fails to compile if the slice the
		// module depends on ever drifts from the class it is given at runtime.
		const real = null as unknown as HubUIClient;
		const asSlice: UiNotifyClient = real;
		expect(asSlice).toBe(real);
	});

	it("unsubscribes from the hub on stop", async () => {
		const fake = fakeClient();
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({}),
			deliver: async () => undefined,
		});

		expect(fake.unsubscribed).toBe(0);
		await subscription.stop();
		expect(fake.unsubscribed).toBe(1);
	});
});

describe("what the subscription hands the adapter", () => {
	it("passes the item and the supersede intent through", async () => {
		const fake = fakeClient();
		const calls: Array<[string, string, unknown]> = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (threadKey, text, options) => {
				calls.push([threadKey, text, options]);
			},
		});

		fake.emit({
			title: "Running",
			body: "Executing Bash",
			source: { workspacePath: "/code/app", itemId: "461e5" },
			supersedesPrevious: true,
		});
		await subscription.flush();

		expect(calls[0]?.[2]).toMatchObject({
			itemId: "461e5",
			workspacePath: "/code/app",
			supersedesPrevious: true,
			awaitingAnswer: false,
		});
		await subscription.stop();
	});

	it("treats a notification without the field as one that stands on its own", async () => {
		// Anything that asks the person for something must arrive as its own message, and a
		// payload that says nothing about superseding is asking for exactly that.
		const fake = fakeClient();
		const calls: unknown[] = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (_threadKey, _text, options) => {
				calls.push(options);
			},
		});

		fake.emit({
			title: "Ready for review",
			body: "card — app",
			source: { workspacePath: "/code/app", itemId: "461e5" },
		});
		await subscription.flush();

		expect(calls[0]).toMatchObject({
			itemId: "461e5",
			workspacePath: "/code/app",
			supersedesPrevious: false,
			awaitingAnswer: false,
		});
		await subscription.stop();
	});
});

describe("what an adapter needs to answer back", () => {
	it("passes the repository along with the item", async () => {
		// Without it the adapter knows which card asked but not which board it lives on, so it
		// cannot carry an answer back.
		const fake = fakeClient();
		const seen: unknown[] = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (_threadKey, _text, options) => {
				seen.push(options);
			},
		});

		fake.emit({
			title: "Ready for review",
			body: "card",
			source: { workspacePath: "/code/app", itemId: "49084" },
		});
		await subscription.flush();

		expect(seen[0]).toMatchObject({
			itemId: "49084",
			workspacePath: "/code/app",
			supersedesPrevious: false,
			awaitingAnswer: false,
		});
		await subscription.stop();
	});
});

describe("whether the thing is waiting on the person", () => {
	it("passes the flag through so the adapter can offer choices", async () => {
		const fake = fakeClient();
		const seen: unknown[] = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (_threadKey, _text, options) => {
				seen.push(options);
			},
		});

		fake.emit({
			title: "Ready for review",
			body: "card — 1) Sim 2) Não",
			source: { workspacePath: "/code/app", itemId: "49084" },
			awaitingAnswer: true,
		});
		await subscription.flush();

		expect(seen[0]).toMatchObject({ awaitingAnswer: true });
		await subscription.stop();
	});

	it("defaults to not waiting, so choices are never offered by accident", async () => {
		// A completed question still carries its options in the text; offering them again sends
		// a tap nowhere and reads like being asked twice.
		const fake = fakeClient();
		const seen: unknown[] = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (_threadKey, _text, options) => {
				seen.push(options);
			},
		});

		fake.emit({
			title: "Ready for review",
			body: "Completed AskUserQuestion: Devo gravar? — 1) Gravar 2) Descartar",
			source: { workspacePath: "/code/app", itemId: "49084" },
		});
		await subscription.flush();

		expect(seen[0]).toMatchObject({ awaitingAnswer: false });
		await subscription.stop();
	});
});

describe("a notification that may only update", () => {
	// A card dragged across the board has something to update and nothing to announce. Without
	// this the adapter cannot tell the two apart, and tidying a board would put a message in
	// the conversation for every card touched.
	it("passes the update-only intent through", async () => {
		const fake = fakeClient();
		const calls: Array<[string, string, unknown]> = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (threadKey, text, options) => {
				calls.push([threadKey, text, options]);
			},
		});

		fake.emit({
			title: "sonda",
			body: "kanban",
			source: { workspacePath: "/code/app", itemId: "a3ae5" },
			supersedesPrevious: true,
			updateOnly: true,
			column: "review",
		});
		await subscription.flush();

		expect(calls[0]?.[2]).toMatchObject({ updateOnly: true, column: "review" });
		await subscription.stop();
	});

	it("treats a notification without the field as one that may announce itself", async () => {
		const fake = fakeClient();
		const calls: Array<[string, string, unknown]> = [];
		const subscription = await startUiNotifyDelivery({
			createClient: () => fake.client,
			readBindings: () => ({ t1: { state: { cwd: "/code/app" } } }),
			deliver: async (threadKey, text, options) => {
				calls.push([threadKey, text, options]);
			},
		});

		fake.emit({
			title: "sonda",
			body: "kanban",
			source: { workspacePath: "/code/app", itemId: "a3ae5" },
			supersedesPrevious: true,
		});
		await subscription.flush();

		expect(calls[0]?.[2]).toMatchObject({ updateOnly: false });
		await subscription.stop();
	});
});
