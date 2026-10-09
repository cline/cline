import type { NativeHubTransport } from "../server/native-transport";
import {
	type DeviceServiceRuntime,
	type StartDeviceServiceOptions,
	startDeviceService,
} from "./runtime";
import type { DeviceServiceStatus } from "./status";

export interface DeviceServiceState extends Partial<DeviceServiceStatus> {
	status: "stopped" | "starting" | "running" | "error";
	devices: string[];
	pairing?: { code: string; expiresAt: number };
	error?: string;
}
export type DeviceServiceOptions = Omit<
	StartDeviceServiceOptions,
	"transport" | "hubUrl" | "changed"
>;
/** One hub owns the service. App clients only issue commands and observe state. */
export class HubDeviceService {
	private runtime?: DeviceServiceRuntime;
	private pending?: Promise<void>;
	private stopping?: Promise<void>;
	private state: DeviceServiceState = { status: "stopped", devices: [] };
	constructor(
		private readonly transport: NativeHubTransport,
		private readonly options: DeviceServiceOptions,
		private readonly changed: () => void,
		private readonly startRuntime = startDeviceService,
	) {}
	snapshot(): DeviceServiceState {
		return this.runtime
			? {
					status: "running",
					...this.runtime.status(),
					pairing: this.runtime.pairingCode(),
				}
			: this.state;
	}
	start(hubUrl: string): Promise<void> {
		if (this.stopping) return this.stopping.then(() => this.start(hubUrl));
		if (this.runtime) return Promise.resolve();
		if (this.pending) return this.pending;
		this.state = { status: "starting", devices: [] };
		this.changed();
		this.pending = this.startRuntime({
			...this.options,
			transport: this.transport,
			hubUrl,
			log: (message) => {
				this.options.log?.(message);
			},
			changed: this.changed,
		})
			.then((runtime) => {
				this.runtime = runtime;
				this.changed();
			})
			.catch((error) => {
				this.state = {
					status: "error",
					devices: [],
					error: error instanceof Error ? error.message : String(error),
				};
				this.changed();
			})
			.finally(() => {
				this.pending = undefined;
			});
		return this.pending;
	}
	pair(): DeviceServiceState {
		if (!this.stopping) this.runtime?.pair();
		this.changed();
		return this.snapshot();
	}
	stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.stopping = this.stopRuntime().finally(() => {
			this.stopping = undefined;
		});
		return this.stopping;
	}
	private async stopRuntime(): Promise<void> {
		await this.pending;
		if (!this.runtime && this.state.status === "stopped") return;
		await this.runtime?.stop();
		this.runtime = undefined;
		this.state = { status: "stopped", devices: [] };
		this.changed();
	}
}
