import {
	CloudSessionController,
	type CloudSessionControllerOptions,
} from "@cline/core/cloud";
import { HubCloudSessionService } from "@cline/core/hub";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach } from "vitest";
import { CloudSessionManager } from "./cloud-sessions";
import type { SidecarContext } from "./types";

const services = new Set<HubCloudSessionService>();
const viewers = new WeakMap<
	SidecarContext,
	() => Promise<CloudSessionManager>
>();
export async function reconnectCloudSessionTestViewer(
	ctx: SidecarContext,
): Promise<CloudSessionManager> {
	const connect = viewers.get(ctx);
	if (!connect) throw new Error("Missing cloud test runtime");
	return await connect();
}
afterEach(async () => {
	await Promise.all([...services].map((service) => service.dispose()));
	services.clear();
});

export class TestCloudSessionController extends CloudSessionController {
	constructor(ctx: SidecarContext, options: CloudSessionControllerOptions) {
		super({
			...options,
			lateCreateDisposition: options.lateCreateDisposition ?? "preserve",
			clientIdentity: options.clientIdentity ?? {
				prefix: "hub-cloud",
				type: "hub-cloud",
				displayName: "Cline Hub cloud session",
				source: "desktop",
			},
		});
		for (const [id, state] of ctx.liveSessions)
			if (state.config.executionTarget === "cloud")
				this.seedSessionState(id, state);
	}
}
export async function createCloudSessionTestRuntime(
	ctx: SidecarContext,
	options: CloudSessionControllerOptions,
): Promise<TestCloudSessionController> {
	const controller = new TestCloudSessionController(ctx, options);
	const listeners = new Set<(event: HubEventEnvelope) => void>();
	const service = new HubCloudSessionService({
		getScope: () => "test-account",
		createController: () => controller,
		publish: (event, version) => {
			for (const listener of listeners)
				listener({
					version: "v1",
					event: "cloud.event",
					sessionId: event?.sessionId,
					payload: { event, ...version },
				});
		},
	});
	services.add(service);
	const connectViewer = async () => {
		const projection = new CloudSessionManager(ctx, async () => ({
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			command: async (command, payload) => ({
				version: "v1",
				ok: true,
				payload:
					command === "cloud.watch"
						? service.watch()
						: await service.command(
								String(payload?.operation),
								payload?.args,
								payload?.scope,
							),
			}),
		}));
		ctx.cloudSessionManager = projection;
		await projection.connect();
		return projection;
	};
	viewers.set(ctx, connectViewer);
	await connectViewer();
	return controller;
}
