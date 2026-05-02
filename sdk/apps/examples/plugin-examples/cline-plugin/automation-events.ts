/**
 * Automation Event Plugin Example
 *
 * Shows how a plugin can declare normalized event types and emit events into
 * ClineCore automation without importing cron internals.
 *
 * Local demo:
 *   mkdir -p .cline/plugins .cline/cron/events
 *   cp apps/examples/plugin-examples/cline-plugin/automation-events.ts .cline/plugins/automation-events.ts
 *   cp apps/examples/cron/events/local-plugin-event.event.md .cline/cron/events/local-plugin-event.event.md
 *   perl -0pi -e "s#/absolute/path/to/repo#$PWD#g" .cline/cron/events/local-plugin-event.event.md
 *   CLINE_LOCAL_EVENT_INTERVAL_MS=2000 cline -i "wait for the plugin event"
 */

import type { AgentPlugin } from "@clinebot/core";

const stopLocalEmitters = new Map<string, () => void>();

function emitterKey(sessionId: string | undefined): string | undefined {
	return sessionId?.trim() || undefined;
}

export const plugin: AgentPlugin = {
	name: "local-automation-events",
	manifest: {
		capabilities: ["automationEvents"],
	},

	setup(api, ctx) {
		api.registerAutomationEventType({
			eventType: "local.plugin_event",
			source: "local-plugin",
			description: "Local normalized event emitted by a plugin",
			attributesSchema: {
				type: "object",
				properties: {
					topic: { type: "string" },
				},
				required: ["topic"],
			},
			examples: [
				{
					eventId: "local-plugin-demo-1",
					eventType: "local.plugin_event",
					source: "local-plugin",
					subject: "plugin-demo",
					occurredAt: "2026-04-24T10:00:00.000Z",
					attributes: { topic: "plugin-demo" },
				},
			],
		});
		ctx.logger?.log("local automation event source registered", {
			sessionId: ctx.session?.sessionId,
			client: ctx.client?.name,
		});

		const intervalMs = Number(process.env.CLINE_LOCAL_EVENT_INTERVAL_MS ?? 0);
		if (!ctx.automation || !Number.isFinite(intervalMs) || intervalMs <= 0) {
			return;
		}

		const key = emitterKey(ctx.session?.sessionId);
		if (!key) {
			ctx.logger?.log(
				"local automation event emitter disabled; setup context has no session id",
				{ severity: "warn" },
			);
			return;
		}
		stopLocalEmitters.get(key)?.();

		const timer = setInterval(() => {
			void ctx.automation?.ingestEvent({
				eventId: `local-plugin-${Date.now()}`,
				eventType: "local.plugin_event",
				source: "local-plugin",
				subject: "plugin-demo",
				occurredAt: new Date().toISOString(),
				dedupeKey: "local-plugin:plugin-demo",
				attributes: { topic: "plugin-demo" },
				payload: {
					message: "Hello from a plugin-emitted automation event.",
				},
			});
		}, intervalMs);

		stopLocalEmitters.set(key, () => clearInterval(timer));
	},
};

export default plugin;
