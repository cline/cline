import { describe, expect, it, vi } from "vitest";
import type { CoreSettingsService } from "../settings";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

describe("hub settings commands", () => {
	it("returns an updated snapshot and publishes settings.changed after toggle", async () => {
		const snapshot = {
			workflows: [],
			rules: [],
			skills: [
				{
					id: "skill-one",
					name: "skill-one",
					path: "/tmp/SKILL.md",
					kind: "skill" as const,
					source: "workspace" as const,
					enabled: false,
					toggleable: true,
				},
			],
			tools: [],
		};
		const settingsService = {
			toggle: vi.fn().mockResolvedValue({
				snapshot,
				changedTypes: ["skills"],
			}),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});
		const events: string[] = [];
		const unsubscribe = transport.subscribe("client-one", (event) => {
			if (event.event === "settings.changed") {
				events.push(JSON.stringify(event.payload));
			}
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "skills",
					id: "skill-one",
					enabled: false,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					snapshot,
					changedTypes: ["skills"],
				},
			});
			expect(settingsService.toggle).toHaveBeenCalledWith({
				type: "skills",
				id: "skill-one",
				enabled: false,
			});
			expect(events).toHaveLength(1);
			expect(JSON.parse(events[0] ?? "{}")).toMatchObject({
				types: ["skills"],
				snapshot,
			});
		} finally {
			unsubscribe();
			await transport.stop();
		}
	});

	it("rejects malformed settings.toggle payloads before calling settings", async () => {
		const settingsService = {
			toggle: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "skillz",
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_toggle_failed",
				},
			});
			expect(reply.error?.message).toContain("settings.toggle payload 'type'");
			expect(settingsService.toggle).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});

	it("rejects malformed settings.list payloads before calling settings", async () => {
		const settingsService = {
			list: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.list",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					workspaceRoot: false,
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_list_failed",
				},
			});
			expect(reply.error?.message).toContain("workspaceRoot");
			expect(settingsService.list).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});
});
