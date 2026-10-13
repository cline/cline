import type { BrowseRequest, DeviceContext } from "@cline/device";
import { describe, expect, it } from "vitest";
import { DeviceNavigation } from "./navigation";

const request = (
	kind: BrowseRequest["kind"],
	extra: Partial<BrowseRequest> = {},
): BrowseRequest => ({ t: "browse", id: "1", kind, ...extra });
function setup(
	models = [
		{ provider: "test", model: "one" },
		{ provider: "test", model: "two" },
	],
) {
	const sessions = Array.from({ length: 7 }, (_, i) => ({
		sessionId: `s${i}`,
		metadata: { title: `Task ${i}` },
		cwd: `/workspace/${i % 2}`,
		updatedAt: 100 - i,
	}));
	return new DeviceNavigation({
		workspace: "/pinned",
		models: async () => models,
		command: async (name, _, session) => {
			if (name === "session.messages" && session !== "s0")
				throw new Error("Unknown session");
			if (name === "session.get")
				return {
					version: "v1",
					ok: true,
					payload: {
						loaded: true,
						session: sessions.find((row) => row.sessionId === session),
					},
				};
			return {
				version: "v1",
				ok: true,
				payload:
					name === "session.messages"
						? {
								messages: [
									{ role: "system", content: "SECRET" },
									{ role: "user", content: [{ type: "text", text: "Hello" }] },
									{
										role: "assistant",
										content: [
											{ type: "tool_call", text: "HIDDEN" },
											{ type: "text", text: "A long reply ".repeat(60) },
										],
									},
								],
							}
						: { sessions },
			};
		},
	});
}
describe("device navigation", () => {
	it("pages five models, exposes the partial last page, and selects its entries", async () => {
		const models = Array.from({ length: 7 }, (_, i) => ({
			provider: "test",
			model: `model-${i}-` + '\\"'.repeat(60),
		}));
		const nav = setup(models);
		const context: DeviceContext = {};
		const first = await nav.browse(request("models"), context);
		expect(first.items).toHaveLength(5);
		expect(first.more).toBe(true);
		const next = await nav.browse(request("models", { page: 1 }), context);
		expect(next.items).toHaveLength(2);
		expect(next.more).toBe(false);
		for (const page of [first, next])
			expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024);
		await nav.browse(
			request("models", { page: 1, key: next.items[1].key, select: true }),
			context,
		);
		expect(context.model).toEqual(models[6]);
	});
	it("loads saved conversations once with their original workspace and model", async () => {
		let creates = 0;
		let createPayload: Record<string, unknown> | undefined;
		const saved = {
			sessionId: "s0",
			cwd: "/original",
			workspaceRoot: "/original",
			metadata: { provider: "test", model: "original", title: "Original task" },
			runtimeOptions: { mode: "act", enableTools: true },
		};
		const messages = [
			{ role: "user", content: [{ type: "text", text: "original prompt" }] },
		];
		const nav = new DeviceNavigation({
			models: async () => [],
			command: async (name, payload) => {
				if (name === "session.create") {
					creates++;
					createPayload = payload;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
				return {
					version: "v1",
					ok: true,
					payload:
						name === "session.list"
							? { sessions: [saved] }
							: name === "session.get"
								? { session: saved, loaded: false }
								: { messages },
				};
			},
		});
		const a: DeviceContext = {
				model: { provider: "test", model: "new-default" },
			},
			b: DeviceContext = {};
		await Promise.all([
			nav.browse(request("sessions", { select: true, key: "s0" }), a),
			nav.browse(request("sessions", { select: true, key: "s0" }), b),
		]);
		expect(creates).toBe(1);
		expect(createPayload).toMatchObject({
			cwd: "/original",
			initialMessages: messages,
			sessionConfig: {
				sessionId: "s0",
				providerId: "test",
				modelId: "original",
			},
		});
		expect(a.session).toBe("s0");
		expect(b.session).toBe("s0");
	});

	it("pages recent sessions, validates selections, and isolates each device", async () => {
		const nav = setup();
		const a: DeviceContext = {},
			b: DeviceContext = {};
		const first = await nav.browse(request("sessions"), a);
		expect(first.items.map((row) => row.key)).toEqual([
			"s0",
			"s1",
			"s2",
			"s3",
			"s4",
		]);
		expect(first.items[0].label).toBe("Task 0");
		expect(first.more).toBe(true);
		expect(
			(await nav.browse(request("sessions", { page: 1 }), a)).items,
		).toHaveLength(2);
		await nav.browse(request("sessions", { select: true, key: "s0" }), a);
		expect(a.session).toBe("s0");
		expect(b).toEqual({});
		await expect(
			nav.browse(request("sessions", { select: true, key: "missing" }), a),
		).rejects.toThrow("no longer available");
	});
	it("deduplicates workspaces and applies settings to new tasks", async () => {
		const nav = setup();
		const context: DeviceContext = { session: "s0" };
		const paths = await nav.browse(request("workspaces"), context);
		expect(paths.items).toHaveLength(3);
		await nav.browse(
			request("workspaces", { select: true, key: paths.items[0].key }),
			context,
		);
		expect(context).toEqual({ workspace: "/pinned" });
		const models = await nav.browse(request("models"), context);
		await nav.browse(
			request("models", { select: true, key: models.items[1].key }),
			context,
		);
		expect(context.model).toEqual({ provider: "test", model: "two" });
		expect(JSON.stringify(models)).not.toContain("apiKey");
	});
	it("reads conversation text in five-line pages within frame limits", async () => {
		const nav = setup();
		const first = await nav.browse(request("history", { key: "s0" }), {});
		expect(first.text).toContain("You: Hello");
		expect(first.text).toContain("Cline:");
		expect(first.text).not.toContain("SECRET");
		expect(first.text).not.toContain("HIDDEN");
		expect(first.text!.split("\n").length).toBeLessThanOrEqual(5);
		expect(first.more).toBe(true);
		for (let page = 0; page < 10; page++) {
			const result = await nav.browse(
				request("history", { key: "s0", page }),
				{},
			);
			expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
				1024,
			);
		}
		await expect(
			nav.browse(request("history", { key: "missing" }), {}),
		).rejects.toThrow("Unknown session");
	});
});
