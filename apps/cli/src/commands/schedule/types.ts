export interface CommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

export type ScheduleActionWrapper = <T extends unknown[]>(
	fn: (...args: T) => Promise<void>,
) => (...args: T) => Promise<void>;
