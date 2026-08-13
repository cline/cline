export const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

/** Internal parent-to-child transport for the resolved idle timeout. */
export const SUBPROCESS_SANDBOX_IDLE_TIMEOUT_MS_ENV =
	"CLINE_SUBPROCESS_SANDBOX_IDLE_TIMEOUT_MS";

type ParentProcess = {
	once(event: "disconnect", listener: () => void): unknown;
	exit(code: number): unknown;
};

export function parseIdleTimeoutMs(
	value: string | undefined,
): number | undefined {
	if (!value) {
		return undefined;
	}
	return normalizeIdleTimeoutMs(Number(value));
}

export function normalizeIdleTimeoutMs(
	timeoutMs: number | undefined,
): number | undefined {
	return typeof timeoutMs === "number" &&
		Number.isInteger(timeoutMs) &&
		timeoutMs > 0 &&
		timeoutMs <= MAX_NODE_TIMER_DELAY_MS
		? timeoutMs
		: undefined;
}

/** Ensure an IPC child cannot survive the process that owns it. */
export function installParentDisconnectGuard(
	target: ParentProcess = process,
): void {
	target.once("disconnect", () => target.exit(0));
}

/**
 * Tracks concurrent RPC calls and runs cleanup only after a full idle period.
 * Calls are reference-counted because Node's async message handlers can overlap.
 */
export class IdleExitController {
	private timeoutMs: number | undefined;
	private activeCalls = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly onIdle: () => void) {}

	configure(timeoutMs: number | undefined): void {
		this.timeoutMs = normalizeIdleTimeoutMs(timeoutMs);
		this.arm();
	}

	beginCall(): void {
		this.activeCalls += 1;
		this.clear();
	}

	endCall(): void {
		if (this.activeCalls > 0) {
			this.activeCalls -= 1;
		}
		this.arm();
	}

	private arm(): void {
		this.clear();
		if (this.timeoutMs === undefined || this.activeCalls > 0) {
			return;
		}
		const timer = setTimeout(() => {
			if (this.timer === timer) {
				this.timer = undefined;
			}
			this.onIdle();
		}, this.timeoutMs);
		timer.unref();
		this.timer = timer;
	}

	private clear(): void {
		if (!this.timer) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}
