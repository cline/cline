import type { EventEmitter } from "node:events";
import { expect } from "vitest";
import { createSapAiCoreProviderModule } from "./community";

type Listener = (...args: unknown[]) => void;
const emitter = process as unknown as EventEmitter;
const EVENTS = ["uncaughtException", "unhandledRejection"] as const;

const snapshot = () =>
	Object.fromEntries(EVENTS.map((event) => [event, emitter.listeners(event)]));

/**
 * Builds the SAP provider for the first time in this process while the "host"
 * registers its own listeners during the load, then checks that only the SAP
 * SDK's exit handlers were removed. Must run in a fresh process (one test per file):
 * once the SAP modules are cached, the import arms nothing and the check would
 * pass without exercising the cleanup.
 */
export async function expectSapLoadLeavesOnlyHostListeners(
	defaultSettings?: Record<string, unknown>,
): Promise<{ rejected: boolean }> {
	const before = snapshot();

	// Prove the import really armed winston's exit handler in this process.
	let sapArmed = 0;
	const spy = (event: string | symbol, listener: Listener) => {
		if (
			event === "uncaughtException" &&
			listener.name === "bound _uncaughtException"
		) {
			sapArmed += 1;
		}
	};
	emitter.on("newListener", spy);

	// Host listeners registered after loading has started but before the SAP
	// modules are evaluated, so they land between the import and its cleanup.
	// The exception listener carries winston's own name, as a host's winston
	// logger would.
	const hostException = function _uncaughtException() {}.bind({});
	const hostRejection: Listener = () => {};
	const pending = createSapAiCoreProviderModule({
		providerId: "sapaicore",
		baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
		options: {
			clientId: "sap-client",
			clientSecret: "sap-secret",
			tokenUrl: "https://auth.example/oauth/token",
			deploymentId: "deployment-id",
			...(defaultSettings ? { defaultSettings } : {}),
		},
	});
	emitter.on("uncaughtException", hostException);
	emitter.on("unhandledRejection", hostRejection);

	let rejected = false;
	try {
		await pending;
	} catch {
		rejected = true;
	} finally {
		emitter.removeListener("newListener", spy);
	}
	try {
		expect(sapArmed).toBeGreaterThan(0);
		expect(emitter.listeners("uncaughtException")).toEqual([
			...before.uncaughtException,
			hostException,
		]);
		expect(emitter.listeners("unhandledRejection")).toEqual([
			...before.unhandledRejection,
			hostRejection,
		]);
	} finally {
		emitter.removeListener("uncaughtException", hostException);
		emitter.removeListener("unhandledRejection", hostRejection);
	}
	return { rejected };
}
