import { normalizeHubWebSocketUrl } from "../client";
import { HubRuntimeHost, type HubRuntimeHostOptions } from "./hub-runtime-host";

export interface RemoteRuntimeHostOptions
	extends Omit<HubRuntimeHostOptions, "url"> {
	endpoint: string;
	workspaceRoot?: string;
	cwd?: string;
}

export class RemoteRuntimeHost extends HubRuntimeHost {
	constructor(options: RemoteRuntimeHostOptions) {
		super(
			{
				url: normalizeHubWebSocketUrl(options.endpoint),
				authToken: options.authToken,
				clientType: options.clientType ?? "core-remote-runtime",
				displayName: options.displayName ?? "core remote runtime",
				capabilities: options.capabilities,
			},
			{
				workspaceRoot: options.workspaceRoot,
				cwd: options.cwd,
			},
		);
	}
}
