import type { ProviderSettings, ProviderSettingsManager } from "@cline/core";
import type { BasicLogger, RuntimeLoggerConfig } from "@cline/shared";

export type ConnectorLoggerAdapter = {
	readonly core: BasicLogger;
	readonly runtimeConfig: RuntimeLoggerConfig;
	child(bindings: Record<string, unknown>): ConnectorLoggerAdapter;
};

export type CreateConnectorLoggerInput = {
	runtime: "cli" | "rpc-runtime";
	component?: string;
	runtimeConfig?: RuntimeLoggerConfig;
};

export type ConnectIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
	createLogger?: (input: CreateConnectorLoggerInput) => ConnectorLoggerAdapter;
	resolveSessionMetadata?: (
		sessionId: string,
	) => Promise<Record<string, unknown> | undefined>;
	ensureProviderApiKey?: (input: {
		providerId: string;
		currentApiKey?: string;
		existingSettings?: ProviderSettings;
		providerSettingsManager: ProviderSettingsManager;
	}) => Promise<{
		apiKey?: string;
		selectedProviderSettings?: ProviderSettings;
	}>;
};

export type ConnectStopResult = {
	stoppedProcesses: number;
	stoppedSessions: number;
};

export interface ConnectCommandDefinition {
	name: string;
	description: string;
	run(args: string[], io: ConnectIo): Promise<number>;
	showHelp(io: ConnectIo): void;
	stopAll?(io: ConnectIo): Promise<ConnectStopResult>;
}
