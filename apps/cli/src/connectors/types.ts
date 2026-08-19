export type ConnectIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export type ConnectStopResult = {
	stoppedProcesses: number;
	failedProcesses: number;
	stoppedSessions: number;
};

export type ConnectRunContext = {
	setPersistenceArgs: (args: string[]) => void;
	setPersistenceInstanceId: (instanceId: string) => void;
};

export interface ConnectCommandDefinition {
	name: string;
	description: string;
	run(
		args: string[],
		io: ConnectIo,
		context: ConnectRunContext,
	): Promise<number>;
	validate(args: string[], io: ConnectIo): Promise<number>;
	showHelp(io: ConnectIo): void;
	/**
	 * Instance id `args` would run as, when it is knowable without side effects.
	 * The hub keys connector supervision by (channel, instanceId) and needs it
	 * before spawning; undefined sends the caller to the local start path.
	 */
	resolveInstanceId?(args: string[]): string | undefined;
	stopAll?(io: ConnectIo): Promise<ConnectStopResult>;
	stopInstance?(instanceId: string, io: ConnectIo): Promise<ConnectStopResult>;
}
