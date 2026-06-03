export type ConnectIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
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
