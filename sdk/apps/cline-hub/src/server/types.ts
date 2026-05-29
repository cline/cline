import type { SaveProviderSettingsActionRequest } from "@cline/core";
import type { ToolApprovalResult } from "@cline/shared";
import type {
	WebviewInboundMessage,
	WebviewReasonLevel,
} from "../webview-protocol";

export type BrowserFrame = WebviewInboundMessage | { type: "restart_hub" };

export type ProviderSettingsUpdate = Partial<
	Omit<SaveProviderSettingsActionRequest, "action" | "providerId">
>;

export interface BrowserConfig {
	inviteRequired: boolean;
	publicUrl: string;
}

export type TrackedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
};

export type TrackedSession = {
	sessionId: string;
	status: string;
	title: string;
	workspaceRoot: string;
	cwd?: string;
	provider?: string;
	model?: string;
	source?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
	participantCount: number;
};

export type SessionContext = {
	workspaceRoot: string;
	cwd: string;
	providerId: string;
	modelId: string;
};

export type BrowserPeer = {
	socket: Bun.ServerWebSocket<BrowserPeer>;
	displayName: string;
	selectedSessionId?: string;
	unsubscribeEvents?: () => void;
	sending: boolean;
};

export type PendingToolApproval = {
	sessionId: string;
	resolve: (result: ToolApprovalResult) => void;
	timeout: ReturnType<typeof setTimeout>;
};

export type JsonRecord = Record<string, unknown>;

export type { WebviewReasonLevel };
