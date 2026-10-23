import type { ToolApprovalRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { ScriptedRuntimeHost } from "../../../sdk/packages/hub-testkit/src/scripted-runtime-host";
import { createMobileFixtureHost } from "./dev-hub";

const FixtureHost = createMobileFixtureHost(ScriptedRuntimeHost);

describe("mobile dev hub fixture", () => {
	it("emits a bounded local PCM audio fixture", async () => {
		const host = new FixtureHost({
			workspaceRoot: "/fixture",
			approvals: "wait-for-respond",
		});
		let media:
			| { mediaType: string; source: { type: string; data: string } }
			| undefined;
		host.subscribe((envelope) => {
			if (envelope.type !== "agent_event") return;
			const event = envelope.payload.event as {
				contentType?: string;
				media?: typeof media;
			};
			if (event.contentType === "media") media = event.media;
		});
		await host.startSession({ config: { sessionId: "audio" } });
		await host.runTurn({ sessionId: "audio", prompt: "sample-audio" });
		expect(media?.mediaType).toBe("audio/wav");
		expect(media?.source.type).toBe("base64");
		const wav = Buffer.from(media!.source.data, "base64");
		expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
		expect(wav.readUInt32LE(4) + 8).toBe(wav.length);
		expect(wav.readUInt32LE(40) + 44).toBe(wav.length);
		expect(wav.length).toBeLessThan(16 * 1024);
	});

	it("routes questions and approvals to the originating session after another opens", async () => {
		const host = new FixtureHost({
			workspaceRoot: "/fixture",
			approvals: "wait-for-respond",
		});
		const firstQuestion = vi.fn(async () => "first answer");
		const secondQuestion = vi.fn(async () => "second answer");
		const firstApproval = vi.fn(async (_request: ToolApprovalRequest) => ({
			approved: true,
		}));
		const secondApproval = vi.fn(async () => ({ approved: true }));
		await host.startSession({
			config: { sessionId: "first" },
			capabilities: {
				toolExecutors: { askQuestion: firstQuestion },
				requestToolApproval: firstApproval,
			},
		});
		await host.startSession({
			config: { sessionId: "second" },
			capabilities: {
				toolExecutors: { askQuestion: secondQuestion },
				requestToolApproval: secondApproval,
			},
		});
		await host.runTurn({ sessionId: "first", prompt: "ask-question" });
		await host.runTurn({ sessionId: "first", prompt: "approval-fixture" });
		expect(firstQuestion).toHaveBeenCalledOnce();
		expect(firstApproval).toHaveBeenCalledOnce();
		expect(firstApproval.mock.calls[0]?.[0]).toMatchObject({
			sessionId: "first",
		});
		expect(secondQuestion).not.toHaveBeenCalled();
		expect(secondApproval).not.toHaveBeenCalled();
	});
});
