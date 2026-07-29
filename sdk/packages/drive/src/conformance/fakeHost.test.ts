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

	it("Cline defaults do not advertise unwired promptRewrite or worktreeIsolation", () => {
		expect(CLINE_HOST_CAPABILITIES.promptRewrite).toBe(false);
		expect(CLINE_HOST_CAPABILITIES.worktreeIsolation).toBe(false);
		expect(CLINE_HOST_CAPABILITIES.roomOps).toBe(true);
		expect(CLINE_HOST_CAPABILITIES.durableConfigIo).toBe(true);
		expect(CLINE_HOST_CAPABILITIES.eventsFirstStage).toBe(true);
	});

	it("fakeHost fails closed on declared capabilities", async () => {
		const host = fakeHost({
			...CLINE_HOST_CAPABILITIES,
			promptRewrite: true,
		});
		await expect(
			host.commitRoomOp({ type: "leave", participantId: "x" }),
		).rejects.toBeInstanceOf(FakeHostCapabilityError);
		await expect(
			host.applyPromptRewrite({ turnId: "t", rewrite: "x" }),
		).rejects.toBeInstanceOf(FakeHostCapabilityError);

		const report = await assertFakeHostFailClosed(host);
		expect(report.ok).toBe(true);
	});

	it("skips promptRewrite probe when capability is false", async () => {
		const host = fakeHost(CLINE_HOST_CAPABILITIES);
		expect(host.capabilities.promptRewrite).toBe(false);
		const report = await assertFakeHostFailClosed(host);
		expect(report.ok).toBe(true);
		expect(report.issues.some((i) => i.message.includes("promptRewrite"))).toBe(
			false,
		);
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
