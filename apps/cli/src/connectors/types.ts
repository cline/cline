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
	stopAll?(io: ConnectIo): Promise<ConnectStopResult>;
	stopInstance?(instanceId: string, io: ConnectIo): Promise<ConnectStopResult>;
}
