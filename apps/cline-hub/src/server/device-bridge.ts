import type { ProviderSettingsManager } from "@cline/core";
import { resolveClineDataDir } from "@cline/shared/storage";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_DEVICE_PORT,
	DEFAULT_WEB_PORT,
	startDeviceBridge,
	type DeviceBridgeRuntime,
	type StartDeviceBridgeOptions,
} from "@cline/device-bridge";
import { parseDeviceBridgeStatus } from "@cline/device-bridge/status";
import type { WebviewDeviceBridgeState } from "../webview-protocol";

interface ControllerOptions {
	hub: () => { url: string; authToken: string };
	changed: () => void;
	webviewDistDir: string;
	start?: typeof startDeviceBridge;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	port?: number;
	providers?: ProviderSettingsManager;
}

/** Dashboard-owned lifecycle; an independently started bridge is read-only. */
export class DeviceBridgeController {
	private runtime?: DeviceBridgeRuntime;
	private starting?: Promise<void>;
	private stopping?: Promise<void>;
	private readonly defaults: Pick<
		StartDeviceBridgeOptions,
		"host" | "webPort" | "workspace" | "dataDir" | "providers"
	>;
	private state: WebviewDeviceBridgeState = { status: "stopped", devices: [] };
	private readonly port: number;
	constructor(private readonly options: ControllerOptions) {
		this.defaults = {
			host: process.env.CLINE_DEVICE_HOST ?? "0.0.0.0",
			webPort: Number(process.env.CLINE_DEVICE_WEB_PORT ?? DEFAULT_WEB_PORT),
			workspace: process.env.CLINE_DEVICE_WORKSPACE,
			dataDir: resolveClineDataDir(),
			providers: options.providers,
		};
		this.port =
			options.port ??
			Number(process.env.CLINE_DEVICE_PORT ?? DEFAULT_DEVICE_PORT);
	}
	snapshot(): WebviewDeviceBridgeState {
		return this.runtime
			? {
					status: "running",
					...this.runtime.status(),
					pairing: this.runtime.pairingCode(),
				}
			: this.state;
	}
	private update(state: WebviewDeviceBridgeState) {
		this.state = state;
		this.options.changed();
	}
	private async external(): Promise<WebviewDeviceBridgeState | undefined> {
		try {
			const response = await (this.options.fetch ?? fetch)(
				`http://127.0.0.1:${this.port}/health`,
				{ signal: AbortSignal.timeout(750) },
			);
			if (!response.ok) return;
			const body = await response.json();
			const status = parseDeviceBridgeStatus(body);
			if (status) return { status: "external", ...status };
			if (
				body &&
				typeof body === "object" &&
				"ok" in body &&
				body.ok === true &&
				"v" in body &&
				body.v === 1
			)
				return {
					status: "external",
					devices: [],
					error:
						"A separately started bridge is using this port. Stop it in its terminal, then start the bridge here to connect it to this hub.",
				};
		} catch {
			/* No bridge listening. */
		}
		return undefined;
	}
	async refresh(): Promise<void> {
		if (this.runtime || this.starting) return;
		const external = await this.external();
		if (this.runtime || this.starting) return;
		if (external) this.update(external);
		else if (this.state.status === "external")
			this.update({ status: "stopped", devices: [] });
	}
	start(): Promise<void> {
		if (this.stopping) return this.stopping.then(() => this.start());
		if (this.runtime) return Promise.resolve();
		if (this.starting) return this.starting;
		this.starting = this.startRuntime().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}
	private async startRuntime(): Promise<void> {
		this.update({ status: "starting", devices: [] });
		try {
			const external = await this.external();
			if (external) {
				this.update(external);
				return;
			}
			const webRoot = join(this.options.webviewDistDir, "../device-web");
			const options: StartDeviceBridgeOptions = {
				hub: this.options.hub(),
				port: this.port,
				...this.defaults,
				...(existsSync(webRoot) ? { webRoot } : {}),
				log: (message) => {
					console.log(`[cline-device] ${message}`);
					this.options.changed();
				},
			};
			this.runtime = await (this.options.start ?? startDeviceBridge)(options);
			this.update(this.snapshot());
		} catch (error) {
			this.update({
				status: "error",
				devices: [],
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	pair(): void {
		if (!this.runtime || this.stopping) return;
		this.runtime.pair();
		this.options.changed();
	}
	stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.stopping = this.stopRuntime().finally(() => {
			this.stopping = undefined;
		});
		return this.stopping;
	}
	private async stopRuntime(): Promise<void> {
		await this.starting;
		if (!this.runtime) return;
		await this.runtime.stop();
		this.runtime = undefined;
		this.update({ status: "stopped", devices: [] });
	}
}
