import { describe, expect, it } from "vitest";
import {
	assertFakeHostFailClosed,
	CLINE_HOST_CAPABILITIES,
	CLINE_HUB_WRITER_ENDPOINT,
	fakeHost,
	FakeHostCapabilityError,
	runHostConformance,
} from "../index";

describe("host port conformance", () => {
	it("rejects second-daemon writer endpoints", async () => {
		const forbiddenPort = 7891;
		const host = fakeHost({
			...CLINE_HOST_CAPABILITIES,
			writerEndpoint: `ws://127.0.0.1:${forbiddenPort}`,
		});
		const report = await runHostConformance(host);
		expect(report.ok).toBe(false);
		expect(report.issues.some((i) => i.code === "forbidden_writer_endpoint")).toBe(
			true,
		);
	});

	it("accepts Cline hub writer endpoint", async () => {
		const host = fakeHost(CLINE_HOST_CAPABILITIES);
		const report = await runHostConformance(host, {
			harnessId: "cline",
			writerEndpoint: CLINE_HUB_WRITER_ENDPOINT,
		});
		expect(report.ok).toBe(true);
	});

	it("fakeHost fails closed on declared capabilities", async () => {
		const host = fakeHost(CLINE_HOST_CAPABILITIES);
		await expect(
			host.commitRoomOp({ type: "leave", participantId: "x" }),
		).rejects.toBeInstanceOf(FakeHostCapabilityError);

		const report = await assertFakeHostFailClosed(host);
		expect(report.ok).toBe(true);
	});

	it("detects a silent no-op stub", async () => {
		const host = fakeHost(CLINE_HOST_CAPABILITIES);
		const noop = {
			...host,
			async commitRoomOp() {
				return {
					schemaVersion: 1 as const,
					roomId: "r",
					createdAt: new Date().toISOString(),
					driveActive: false,
					subMode: "plan" as const,
					participants: [],
					stage: { sharer: null, pin: null, cards: [] },
					addressSet: { mode: "everyone" as const },
					muteByParticipantId: {},
					raisedHandByParticipantId: {},
					appliedEventIds: [],
				};
			},
		};
		const report = await assertFakeHostFailClosed(noop);
		expect(report.ok).toBe(false);
		expect(report.issues.some((i) => i.code === "capability_noop")).toBe(
			true,
		);
	});
});
