export type ExecResult = {
	exitCode: number;
	output: string;
	durationMs: number;
	timedOut?: boolean;
};

export type SandboxFile = {
	name: string;
	path: string;
	type: "file" | "dir";
	size: number;
	modifiedAt: string | null;
};

export type ProvisionInput = {
	projectId: string;
	projectName: string;
	language: string;
	template: string;
	repoUrl?: string | null;
	repoBranch?: string | null;
};

export type RuntimeStatus = {
	language: string;
	ready: boolean;
	detail: string;
};

export type ProvisionedWorkspace = {
	externalId: string;
	rootPath: string;
	state: "ready";
	runtime: RuntimeStatus;
	setupLog: string[];
};

export type StreamingCommand = {
	sessionId: string;
	commandId: string;
};

export type StreamingSnapshot = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
};

export type ExecuteOptions = {
	cwd?: string;
	timeoutSeconds?: number;
	env?: Record<string, string>;
};

export interface SandboxProvider {
	readonly name: string;
	provision(input: ProvisionInput): Promise<ProvisionedWorkspace>;
	ensureRunning(externalId: string): Promise<{ state: string }>;
	delete(externalId: string): Promise<void>;
	listFiles(
		externalId: string,
		rootPath: string,
		relativePath: string,
		depth: number,
	): Promise<SandboxFile[]>;
	readFile(externalId: string, rootPath: string, relativePath: string): Promise<Buffer>;
	writeFile(
		externalId: string,
		rootPath: string,
		relativePath: string,
		content: Buffer | string,
	): Promise<void>;
	deleteFile(externalId: string, rootPath: string, relativePath: string): Promise<void>;
	execute(
		externalId: string,
		rootPath: string,
		command: string,
		options?: ExecuteOptions,
	): Promise<ExecResult>;
	startStreamingCommand(
		externalId: string,
		rootPath: string,
		command: string,
		options?: ExecuteOptions,
	): Promise<StreamingCommand>;
	getStreamingSnapshot(
		externalId: string,
		sessionId: string,
		commandId: string,
	): Promise<StreamingSnapshot>;
	getPreviewLink(externalId: string, port: number): Promise<{ url: string }>;
	detectRuntime(externalId: string, rootPath: string, language: string): Promise<RuntimeStatus>;
	installRuntime(externalId: string, rootPath: string, language: string): Promise<RuntimeStatus>;
}

export class SandboxNotConfiguredError extends Error {
	constructor() {
		super("No cloud sandbox provider is configured. Set DAYTONA_API_KEY on the server.");
		this.name = "SandboxNotConfiguredError";
	}
}

export class SandboxError extends Error {
	constructor(
		message: string,
		readonly detail?: string,
	) {
		super(message);
		this.name = "SandboxError";
	}
}
