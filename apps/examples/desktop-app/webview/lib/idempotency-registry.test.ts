import { describe, expect, it, vi } from "vitest";
import { createIdempotencyRegistry } from "./idempotency-registry";

describe("createIdempotencyRegistry", () => {
	it("allows duplicate event delivery to schedule state work only once", () => {
		const registry = createIdempotencyRegistry<string>();
		const scheduleDeletionStateUpdates = vi.fn();
		const handleDeletion = (sessionId: string) => {
			if (!registry.claim(sessionId)) return;
			scheduleDeletionStateUpdates();
		};

		handleDeletion("session-1");
		handleDeletion("session-1");

		expect(scheduleDeletionStateUpdates).toHaveBeenCalledOnce();
	});

	it("tracks different event identities independently", () => {
		const registry = createIdempotencyRegistry<string>();

		expect(registry.claim("session-1")).toBe(true);
		expect(registry.claim("session-2")).toBe(true);
		expect(registry.claim("session-1")).toBe(false);
	});
});
