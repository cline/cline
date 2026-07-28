import type { BankSnapshot } from "@cline/shared";

export type DrivePosture = "plan" | "agent" | "ask" | "debug";

export type DrivePostureOverride = "ask" | "debug";

export interface DriveLoopState {
	posture: DrivePosture;
	override: DrivePostureOverride | null;
	boundTaskId: string | null;
}

export interface ResolveDriveLoopInput {
	driveActive: boolean;
	snapshot: BankSnapshot;
	override: DrivePostureOverride | null;
}

export function resolveDriveLoop(
	input: ResolveDriveLoopInput,
): DriveLoopState {
	if (!input.driveActive) {
		return { posture: "plan", override: null, boundTaskId: null };
	}

	if (input.override === "ask") {
		return {
			posture: "ask",
			override: "ask",
			boundTaskId: input.snapshot.nowTaskId,
		};
	}
	if (input.override === "debug") {
		return {
			posture: "debug",
			override: "debug",
			boundTaskId: input.snapshot.nowTaskId,
		};
	}

	if (input.snapshot.nowTaskId) {
		return {
			posture: "agent",
			override: null,
			boundTaskId: input.snapshot.nowTaskId,
		};
	}

	return { posture: "plan", override: null, boundTaskId: null };
}

export type MutationPolicyDecision =
	| { allowed: true }
	| { allowed: false; reason: string; redirect: "plan" | "ask" };

/** Refuse workspace mutations when Ask or when Agent has no bound task. */
export function allowWorkspaceMutation(
	loop: DriveLoopState,
): MutationPolicyDecision {
	if (loop.posture === "ask") {
		return {
			allowed: false,
			reason: "Ask override is active; workspace edits are blocked.",
			redirect: "ask",
		};
	}
	if (loop.posture === "plan") {
		return {
			allowed: false,
			reason:
				"No open DriveTask is bound. Create or activate a plan with open tasks before Agent work.",
			redirect: "plan",
		};
	}
	if (loop.posture === "agent" && !loop.boundTaskId) {
		return {
			allowed: false,
			reason: "Agent posture requires a bound taskId.",
			redirect: "plan",
		};
	}
	return { allowed: true };
}

export function setPostureOverride(
	override: DrivePostureOverride | null,
): DrivePostureOverride | null {
	return override;
}

export function clearPostureOverride(): null {
	return null;
}
