import { normalizeHubWebSocketUrl } from "../hub/client";
import { HubRuntimeHost, type HubRuntimeHostOptions } from "./hub";

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
				requestToolApproval: options.requestToolApproval,
			},
			{
				workspaceRoot: options.workspaceRoot,
				cwd: options.cwd,
			},
		);
	}
}
