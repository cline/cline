import type {
	ProviderListItem,
	UiInboundMessage,
	UiOutboundMessage,
} from "@cline/shared";

/**
 * Hub-specific webview protocol: the canonical UI protocol from
 * `@cline/shared` (UiInboundMessage / UiOutboundMessage) extended with
 * hub-only messages (hub state, connectors, desktop command bridging,
 * provider catalog management). Common chat/session/tool types are imported
 * from `@cline/shared` directly by both the server and the webview.
 */

export type WebviewProviderCatalogItem = ProviderListItem;

export type WebviewConnectedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
};

export type WebviewClientSummary = {
	label: string;
	name: string;
	sessionCount: number;
};

export type WebviewConnectorField = {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
	initialValue?: string;
	options?: Array<{ value: string; label: string; hint?: string }>;
	includeWhen?: {
		flag: string;
		equals?: string;
		notEquals?: string;
	};
};

export type WebviewConnectorSecurityField = {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
};

export type WebviewConnectorChannel = {
	id: string;
	name: string;
	type: "polling" | "webhook" | "hybrid";
	hint: string;
	fields: WebviewConnectorField[];
	security?: {
		prompt: string;
		fields: WebviewConnectorSecurityField[];
	};
};

export type WebviewActiveConnector = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

export type WebviewConnectorChannelsResponse = {
	available: WebviewConnectorChannel[];
	active: WebviewActiveConnector[];
};

export type WebviewActionSessionSummary = {
	sessionId: string;
	title: string;
	status: string;
	workspaceRoot: string;
	workspaceName: string;
	cwd?: string;
	model?: string;
	provider?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
};

export type WebviewHubEvent = {
	id: string;
	title: string;
	body: string;
	severity: "info" | "success" | "warn" | "error";
	timestamp: number;
};

export type WebviewHubState = {
	type: "hub_state";
	connected: boolean;
	hubUrl?: string;
	hubStartedAt?: string;
	coreVersion?: string;
	hubUptime?: string;
	clients: WebviewConnectedClient[];
	connectors: WebviewActiveConnector[];
	sessions: WebviewActionSessionSummary[];
	clientSummaries: WebviewClientSummary[];
	sessionSummaries: WebviewActionSessionSummary[];
	events: WebviewHubEvent[];
	lastWorkspaceRoot?: string;
};

export type WebviewInboundMessage =
	| UiInboundMessage
	| { type: "restart_hub" }
	| {
			type: "desktopCommand";
			id: string;
			command: string;
			args?: Record<string, unknown>;
	  }
	| { type: "loadProviderCatalog" }
	| {
			type: "saveProviderSettings";
			providerId: string;
			enabled?: boolean;
			apiKey?: string;
			baseUrl?: string;
	  }
	| { type: "runProviderOAuthLogin"; providerId: string };

export type WebviewOutboundMessage =
	| UiOutboundMessage
	| {
			type: "desktopCommandResult";
			id: string;
			ok: true;
			result: unknown;
	  }
	| {
			type: "desktopCommandResult";
			id: string;
			ok: false;
			error: string;
	  }
	| {
			type: "provider_catalog";
			providers: WebviewProviderCatalogItem[];
			settingsPath: string;
	  }
	| {
			type: "provider_settings_saved";
			providerId: string;
			enabled: boolean;
	  }
	| {
			type: "provider_oauth_login_done";
			providerId: string;
			accessTokenPresent: boolean;
	  }
	| WebviewHubState;
