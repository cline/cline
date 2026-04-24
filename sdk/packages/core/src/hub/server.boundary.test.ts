import { describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "./runtime-handlers";
import { HubServerTransport } from "./server";

describe("HubServerTransport boundaries", () => {
	it("continues publishing when one listener throws", () => {
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			sessionHost: {
				subscribe: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				send: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				get: vi.fn(),
				list: vi.fn(),
				delete: vi.fn(),
				update: vi.fn(),
				handleHookEvent: vi.fn(),
			} as never,
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const delivered: string[] = [];

		try {
			transport.subscribe("bad", () => {
				throw new Error("listener boom");
			});
			transport.subscribe("good", (event) => {
				delivered.push(event.event);
			});

			(
				transport as unknown as {
					publish: (event: {
						event: string;
						timestamp: number;
						version: "v1";
						eventId: string;
					}) => void;
				}
			).publish({
				version: "v1",
				event: "ui.notify",
				eventId: "evt_1",
				timestamp: Date.now(),
			});

			expect(delivered).toEqual(["ui.notify"]);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"[hub] listener threw while publishing ui.notify:",
				),
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
