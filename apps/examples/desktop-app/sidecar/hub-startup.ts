import type { DesktopHubStatus } from "../webview/lib/desktop-transport";

export type HubStartupStatus = DesktopHubStatus;

const HUB_STARTUP_TIMEOUT_MS = 30_000;

/** Commands the startup screen needs before the Hub is ready. */
const HUB_INDEPENDENT_COMMANDS = new Set(["retry_hub", "export_diagnostics"]);

export function isHubIndependentCommand(command: string): boolean {
	return HUB_INDEPENDENT_COMMANDS.has(command);
}

/**
 * Runs local Hub setup after the sidecar is already reachable, so the webview
 * can show progress, a failure, Retry, and diagnostics export instead of
 * waiting on a backend that never comes up.
 *
 * Only one setup attempt runs at a time. A timeout reports failure but lets
 * the attempt keep going: if a slow Hub answers later, startup still
 * completes. Retry while an attempt is pending waits on that same attempt.
 */
export class HubStartup {
	status: HubStartupStatus = { state: "starting" };
	private attempt?: Promise<void>;
	private timer?: ReturnType<typeof setTimeout>;
	private waiters: Array<() => void> = [];

	constructor(
		private readonly run: () => Promise<void>,
		private readonly onChange: (status: HubStartupStatus) => void,
		private readonly onFailure: (error: unknown) => void,
		private readonly timeoutMs = HUB_STARTUP_TIMEOUT_MS,
	) {}

	start(): void {
		if (this.status.state === "ready") return;
		this.setStatus({ state: "starting" });
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			if (this.status.state === "starting") {
				this.onFailure(
					new Error(
						`Local Hub startup did not finish within ${this.timeoutMs}ms; still waiting in the background`,
					),
				);
				this.setStatus({
					state: "failed",
					error: "Cline Hub did not respond within 30 seconds.",
				});
			}
		}, this.timeoutMs);
		if (this.attempt) return;
		this.attempt = this.run()
			.then(
				() => this.setStatus({ state: "ready" }),
				(error) => {
					this.onFailure(error);
					this.setStatus({
						state: "failed",
						error: "Cline couldn't start or connect to its Hub.",
					});
				},
			)
			.finally(() => {
				this.attempt = undefined;
			});
	}

	/** Resolves once startup is no longer in progress (ready or failed). */
	waitUntilSettled(): Promise<void> {
		if (this.status.state !== "starting") return Promise.resolve();
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	private setStatus(status: HubStartupStatus): void {
		this.status = status;
		if (status.state !== "starting") {
			clearTimeout(this.timer);
			for (const resolve of this.waiters.splice(0)) resolve();
		}
		this.onChange(status);
	}
}
