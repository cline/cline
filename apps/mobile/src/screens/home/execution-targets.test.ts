import { describe, expect, it } from "vitest";
import type { ConnectionDescriptor } from "@/connection";
import { cloudExecutionTargetId } from "@/state/execution-target-store";
import {
	buildHomeExecutionTargets,
	targetCreatesNewSession,
} from "./execution-targets";

describe("buildHomeExecutionTargets", () => {
	it("collapses exact handoff sessions into one computer that can start new work", () => {
		const base: ConnectionDescriptor = {
			mode: "local",
			url: "ws://mac.local:4599/hub",
			label: "MacBook Pro",
			credentialKind: "device-key",
			hubPublicKey: "hub-key",
			devicePrivateKey: "device-key",
		};
		const targets = buildHomeExecutionTargets({
			endpoints: [
				{ ...base, hubSessionId: "one", sessionTitle: "First" },
				{ ...base, hubSessionId: "two", sessionTitle: "Second" },
			],
			cloudTargets: [],
		});
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			mode: "local",
			title: "MacBook Pro",
			descriptor: { url: base.url },
		});
		if (targets[0]?.mode === "local") {
			expect(targets[0].descriptor.hubSessionId).toBeUndefined();
		}
	});

	it("keeps Cloud creation defaults runnable before a sandbox exists", () => {
		const cloud = {
			id: cloudExecutionTargetId({ repoUrl: "https://github.com/cline/cline" }),
			mode: "cloud" as const,
			repoUrl: "https://github.com/cline/cline",
			label: "cline/cline",
			modelId: "model-a",
		};
		expect(
			buildHomeExecutionTargets({ endpoints: [], cloudTargets: [cloud] }),
		).toEqual([
			expect.objectContaining({
				id: cloud.id,
				mode: "cloud",
				title: "cline/cline",
			}),
		]);
	});

	it("offers exact local sessions and resumes rather than recreating them", () => {
		const machine: ConnectionDescriptor = {
			mode: "local",
			url: "ws://mac.local:4599/hub",
			label: "MacBook Pro",
		};
		const sessionDescriptor: ConnectionDescriptor = {
			...machine,
			hubSessionId: "ses_local",
			sessionTitle: "Fix mobile composer",
		};
		const targets = buildHomeExecutionTargets({
			endpoints: [machine],
			cloudTargets: [],
			sessionRows: [
				{
					key: "local-session",
					kind: "session",
					title: "Fix mobile composer",
					location: { kind: "machine", name: "MacBook Pro" },
					online: false,
					descriptor: sessionDescriptor,
				},
			],
		});
		const launch = targets.find((target) => target.mode === "local");
		const resume = targets.find((target) => target.mode === "local-session");
		expect(resume).toMatchObject({
			title: "Fix mobile composer",
			descriptor: { hubSessionId: "ses_local" },
		});
		expect(launch && targetCreatesNewSession(launch)).toBe(true);
		expect(resume && targetCreatesNewSession(resume)).toBe(false);
	});

	it("resumes an existing Cloud row rather than creating an inner replacement", () => {
		const [target] = buildHomeExecutionTargets({
			endpoints: [],
			cloudTargets: [],
			sessionRows: [
				{
					key: "cloud-session",
					kind: "session",
					title: "Cloud work",
					location: { kind: "cloud", name: "Cloud pod" },
					online: true,
					descriptor: {
						mode: "cloud",
						url: "https://pod.example/hub",
						remoteSessionId: "cloud-1",
					},
				},
			],
		});
		expect(target?.mode).toBe("cloud-session");
		expect(target && targetCreatesNewSession(target)).toBe(false);
	});

	it("warns on the machine target when discovery could not reach its hub", () => {
		const [target] = buildHomeExecutionTargets({
			endpoints: [
				{
					mode: "local",
					url: "ws://mac.local:4599/hub",
					label: "MacBook Pro",
				},
			],
			cloudTargets: [],
			unavailableLocalMachineIds: ["ws://mac.local:4599/hub"],
		});
		expect(target?.detail).toBe("Can't reach Cline right now");
	});
});
