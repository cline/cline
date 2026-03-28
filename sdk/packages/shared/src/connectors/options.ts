export type ConnectWhatsAppOptions = {
	userName: string;
	phoneNumberId?: string;
	accessToken?: string;
	appSecret?: string;
	verifyToken?: string;
	apiVersion?: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
	port: number;
	host: string;
	baseUrl: string;
};

export type WhatsAppConnectorState = {
	instanceKey: string;
	userName: string;
	phoneNumberId?: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

export type ConnectTelegramOptions = {
	botToken: string;
	botUsername: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
};

export type TelegramConnectorState = {
	botUsername: string;
	pid: number;
	rpcAddress: string;
	startedAt: string;
};

export type ConnectSlackOptions = {
	userName: string;
	botToken?: string;
	signingSecret?: string;
	clientId?: string;
	clientSecret?: string;
	encryptionKey?: string;
	installationKeyPrefix?: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
	port: number;
	host: string;
	baseUrl: string;
};

export type SlackConnectorState = {
	userName: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

export type ConnectDiscordOptions = {
	userName: string;
	applicationId: string;
	botToken: string;
	publicKey: string;
	mentionRoleIds?: string[];
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
	port: number;
	host: string;
	baseUrl: string;
};

export type DiscordConnectorState = {
	userName: string;
	applicationId: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

export type ConnectGoogleChatOptions = {
	userName: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
	port: number;
	host: string;
	baseUrl: string;
	pubsubTopic?: string;
	impersonateUser?: string;
	useApplicationDefaultCredentials: boolean;
	credentialsJson?: string;
};

export type GoogleChatConnectorState = {
	userName: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};

export type ConnectLinearOptions = {
	userName: string;
	apiKey?: string;
	clientId?: string;
	clientSecret?: string;
	accessToken?: string;
	webhookSecret: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiProviderKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
	port: number;
	host: string;
	baseUrl: string;
};

export type LinearConnectorState = {
	userName: string;
	pid: number;
	rpcAddress: string;
	port: number;
	baseUrl: string;
	startedAt: string;
};
