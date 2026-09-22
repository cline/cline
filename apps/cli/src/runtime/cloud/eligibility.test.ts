import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOUD_FLAG_LEASE_MS, CloudEligibility } from "./eligibility";

const scope = { apiBaseUrl: "https://api.example.test", accountId: "a" };
const gates: CloudEligibility[] = [];
afterEach(async () => {
	for (const gate of gates.splice(0)) await gate.dispose();
	vi.useRealTimers();
	vi.unstubAllEnvs();
});
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function flagService(value = true) {
	return {
		poll: vi.fn(async () => {}),
		getBooleanFlagEnabled: vi.fn(() => value),
		getCacheSnapshot: vi.fn(() => ({ updateTime: Date.now(), userId: "a" })),
		dispose: vi.fn(async () => {}),
	};
}
describe("CloudEligibility", () => {
	it("requires an authenticated scope and a true PostHog flag", async () => {
		const service = flagService(true);
		const factory = vi.fn(() => service);
		const gate = new CloudEligibility({ createService: factory });
		gates.push(gate);
		expect(gate.getSnapshot().enabled).toBe(false);
		await gate.setScope(scope);
		expect(gate.getSnapshot().enabled).toBe(true);
		expect(service.getBooleanFlagEnabled).toHaveBeenCalledWith(
			"cli-cloud-agents",
		);
		await gate.setScope(undefined);
		expect(gate.getSnapshot().enabled).toBe(false);
	});
	it("a false flag cannot be bypassed by the old environment variable", async () => {
		vi.stubEnv("CLINE_CLI_CLOUD_AGENTS", "1");
		const gate = new CloudEligibility({
			createService: () => flagService(false),
		});
		gates.push(gate);
		await gate.setScope(scope);
		expect(gate.getSnapshot().enabled).toBe(false);
	});
	it("a missing PostHog project key leaves cloud off", async () => {
		vi.stubEnv("TELEMETRY_SERVICE_API_KEY", "");
		vi.stubEnv("CLINE_CLI_CLOUD_AGENTS", "1");
		const gate = new CloudEligibility();
		gates.push(gate);
		await gate.setScope(scope);
		expect(gate.getSnapshot().enabled).toBe(false);
	});
	it("ignores a late positive A poll after A → B → A", async () => {
		const delayed = deferred();
		const first = flagService();
		first.poll.mockImplementation(() => delayed.promise);
		const second = flagService(false);
		const third = flagService(false);
		const factory = vi
			.fn()
			.mockReturnValueOnce(first)
			.mockReturnValueOnce(second)
			.mockReturnValueOnce(third);
		const gate = new CloudEligibility({
			createService: factory,
		});
		gates.push(gate);
		const firstScope = gate.setScope(scope);
		while (!first.poll.mock.calls.length)
			await new Promise((resolve) => setTimeout(resolve, 0));
		await gate.setScope({ ...scope, organizationId: "b" });
		await gate.setScope(scope);
		delayed.resolve();
		await firstScope;
		expect(gate.getSnapshot().enabled).toBe(false);
		expect(first.dispose).toHaveBeenCalledOnce();
	});
	it("revokes on empty/false results and expires a transient failure lease", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const service = flagService();
		const fetched = Date.now();
		service.getCacheSnapshot.mockReturnValue({
			updateTime: fetched,
			userId: "a",
		});
		const gate = new CloudEligibility({
			createService: () => service,
		});
		gates.push(gate);
		await gate.setScope(scope);
		service.poll.mockRejectedValue(new Error("transient"));
		await gate.refresh();
		expect(gate.getSnapshot().enabled).toBe(true);
		await vi.advanceTimersByTimeAsync(CLOUD_FLAG_LEASE_MS);
		expect(gate.getSnapshot().enabled).toBe(false);
		service.poll.mockResolvedValue();
		service.getBooleanFlagEnabled.mockReturnValue(false);
		await gate.refresh();
		expect(gate.getSnapshot().available).toBe(false);
	});
	it("a cached positive never renews its original five minute lease", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const fetched = Date.now();
		const service = flagService();
		service.getCacheSnapshot.mockReturnValue({
			updateTime: fetched,
			userId: "a",
		});
		const gate = new CloudEligibility({
			createService: () => service,
		});
		gates.push(gate);
		await gate.setScope(scope);
		await vi.advanceTimersByTimeAsync(CLOUD_FLAG_LEASE_MS + 1);
		expect(gate.getSnapshot().enabled).toBe(false);
	});
});
