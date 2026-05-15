/**
 * Telemetry smoke test for ENG-1902.
 *
 * Runs each activation/workspace funnel event through the SDK telemetry
 * helpers using a minimal capturing telemetry service. Prints the captured
 * event names and event-specific payloads so a human can verify no raw
 * paths leak and that the legacy snake_case schema is preserved. Activation
 * and workspace events are routed through normal `capture` so they respect
 * the user's telemetry opt-out setting.
 *
 * Usage:
 *   bunx --bun tsx packages/core/scripts/telemetry-smoke.ts
 *   # or
 *   bun packages/core/scripts/telemetry-smoke.ts
 */
import type { ITelemetryService, TelemetryProperties } from "@cline/shared";
import {
	captureConversationTurnEvent,
	captureExtensionActivated,
	captureTaskCompleted,
	captureTaskCreated,
	captureTaskRestarted,
	captureWorkspaceInitError,
	captureWorkspaceInitialized,
	captureWorkspacePathResolved,
} from "../src/services/telemetry/core-events";
import {
	emitWorkspaceLifecycleTelemetry,
	resetWorkspaceTelemetryForTests,
} from "../src/services/workspace/workspace-telemetry";

type RecordedEvent = {
	name: string;
	properties?: Record<string, unknown>;
	required: boolean;
};

/**
 * Minimal capturing stub used by the smoke harness. Intentionally **not**
 * declared `implements ITelemetryService` because this file is a CLI smoke
 * harness — its purpose is to record `capture()` / `captureRequired()`
 * payloads for human inspection, not to track every method that lands on
 * the production telemetry interface (e.g. `setMetadata`,
 * `setCommonProperties`, the `recordCounter` overload). Casting the
 * instance via `unknown as ITelemetryService` at the call site lets the
 * harness stay tiny while still typechecking under
 * `tsconfig.smoke.json`.
 */
class CapturingTelemetry {
	readonly events: RecordedEvent[] = [];

	capture(event: { event: string; properties?: TelemetryProperties }): void {
		this.events.push({
			name: event.event,
			properties: event.properties as Record<string, unknown> | undefined,
			required: false,
		});
	}

	captureRequired(event: string, properties?: TelemetryProperties): void {
		this.events.push({
			name: event,
			properties: properties as Record<string, unknown> | undefined,
			required: true,
		});
	}

	setDistinctId(_id?: string): void {}
	updateCommonProperties(_props: TelemetryProperties): void {}
	identify(_distinctId: string, _properties?: TelemetryProperties): void {}
	isEnabled(): boolean {
		return true;
	}
	async dispose(): Promise<void> {}
	async flush(): Promise<void> {}
	recordCounter(): void {}
	recordHistogram(): void {}
	recordGauge(): void {}
}

/**
 * Cast helper so call sites can pass the harness stub to functions that
 * accept the real `ITelemetryService` without each call duplicating the
 * `unknown` cast. See {@link CapturingTelemetry} for why we don't track
 * the production interface directly.
 */
function asITelemetryService(stub: CapturingTelemetry): ITelemetryService {
	return stub as unknown as ITelemetryService;
}

function header(title: string) {
	console.log(`\n=== ${title} ===`);
}

function rawPathLeakCheck(events: RecordedEvent[], rawPath: string) {
	for (const evt of events) {
		const dump = JSON.stringify(evt.properties ?? {});
		if (dump.includes(rawPath)) {
			console.log(`!! event ${evt.name} leaks raw path; properties=${dump}`);
			process.exitCode = 2;
			return;
		}
	}
	console.log(
		`✓ no raw workspace path "${rawPath}" leaked into ${events.length} captured event(s).`,
	);
}

function dumpEvents(events: RecordedEvent[]) {
	for (const evt of events) {
		// Activation/workspace events are now routed through normal `capture`
		// so the [required] tag is only kept for visibility on any unexpected
		// captureRequired() usage during the smoke run.
		const tag = evt.required ? "[required]" : "[event]   ";
		console.log(`${tag} ${evt.name} ${JSON.stringify(evt.properties ?? {})}`);
	}
}

/**
 * Assertion helper for smoke checks. Logs the comparison and, when the
 * assertion fails, sets `process.exitCode = 1` so CI can catch regressions
 * if the smoke harness is wired into a check step. Without this the script
 * would happily exit 0 on a count mismatch and silently mask broken
 * telemetry plumbing.
 */
function assertSmoke(
	label: string,
	actual: number | string | boolean,
	expected: number | string | boolean,
): void {
	const ok = actual === expected;
	const marker = ok ? "✓" : "!!";
	console.log(`${marker} ${label}: actual=${actual} expected=${expected}`);
	if (!ok) {
		process.exitCode = 1;
	}
}

async function main() {
	resetWorkspaceTelemetryForTests();

	header("user.extension_activated (CLI/VS Code activation parity)");
	{
		const t = new CapturingTelemetry();
		captureExtensionActivated(asITelemetryService(t));
		dumpEvents(t.events);
	}

	header("workspace.initialized + workspace.init_error (lifecycle emitter)");
	{
		const t = new CapturingTelemetry();
		const healthyRoot = "/tmp/healthy-repo";
		const brokenRoot = "/tmp/broken-repo";
		const tSvc = asITelemetryService(t);
		emitWorkspaceLifecycleTelemetry({
			telemetry: tSvc,
			rootPath: healthyRoot,
			rootCount: 1,
			vcsType: "git",
			durationMs: 92.7155,
			featureFlagEnabled: true,
		});
		// duplicate call to verify per-process de-dup
		emitWorkspaceLifecycleTelemetry({
			telemetry: tSvc,
			rootPath: healthyRoot,
			rootCount: 1,
			vcsType: "git",
			durationMs: 12.345,
		});
		emitWorkspaceLifecycleTelemetry({
			telemetry: tSvc,
			rootPath: brokenRoot,
			rootCount: 0,
			vcsType: "none",
			initError: {
				errorType: "WorkspaceSetupError",
				message: "permission denied while probing git repository",
			},
		});
		dumpEvents(t.events);
		rawPathLeakCheck(t.events, healthyRoot);
		rawPathLeakCheck(t.events, brokenRoot);
		const initialized = t.events.filter(
			(e) => e.name === "workspace.initialized",
		);
		const initError = t.events.filter((e) => e.name === "workspace.init_error");
		console.log(
			`emitted ${initialized.length} workspace.initialized and ${initError.length} workspace.init_error events; expected 2 + 1.`,
		);
		assertSmoke(
			"workspace.initialized count (after de-dup gate)",
			initialized.length,
			2,
		);
		assertSmoke("workspace.init_error count", initError.length, 1);
	}

	header("explicit captureWorkspaceInitialized payload sample");
	{
		const t = new CapturingTelemetry();
		captureWorkspaceInitialized(asITelemetryService(t), {
			root_count: 2,
			vcs_types: ["git", "hg"],
			init_duration_ms: 134.5,
			feature_flag_enabled: true,
			is_remote_workspace: false,
		});
		dumpEvents(t.events);
	}

	header("explicit captureWorkspaceInitError payload sample");
	{
		const t = new CapturingTelemetry();
		captureWorkspaceInitError(
			asITelemetryService(t),
			Object.assign(new Error("simulated init failure"), {
				name: "WorkspaceSetupError",
			}),
			{ fallback_to_single_root: true, workspace_count: 0 },
		);
		dumpEvents(t.events);
	}

	header("explicit captureWorkspacePathResolved payload sample");
	{
		const t = new CapturingTelemetry();
		captureWorkspacePathResolved(asITelemetryService(t), {
			ulid: "ulid-smoke-explicit",
			context: "search_codebase",
			resolution_type: "hint_provided",
			hint_type: "workspace_name",
			resolution_success: true,
			target_workspace_index: 1,
			is_multi_root_enabled: true,
		});
		dumpEvents(t.events);
	}

	header("task.created (canonical task-start event for new sessions)");
	{
		const t = new CapturingTelemetry();
		captureTaskCreated(asITelemetryService(t), {
			ulid: "ulid-smoke-task-1",
			apiProvider: "anthropic",
		});
		dumpEvents(t.events);
		const created = t.events.filter((e) => e.name === "task.created");
		console.log(
			`emitted ${created.length} task.created event(s); expected exactly 1.`,
		);
		assertSmoke("task.created count", created.length, 1);
	}

	header("task.restarted (sibling event when an existing task is resumed)");
	{
		const t = new CapturingTelemetry();
		captureTaskRestarted(asITelemetryService(t), {
			ulid: "ulid-smoke-task-1",
			apiProvider: "anthropic",
		});
		dumpEvents(t.events);
		const restarted = t.events.filter((e) => e.name === "task.restarted");
		console.log(
			`emitted ${restarted.length} task.restarted event(s); expected exactly 1.`,
		);
		assertSmoke("task.restarted count", restarted.length, 1);
	}

	header("task.conversation_turn (user + assistant turns)");
	{
		const t = new CapturingTelemetry();
		const tSvc = asITelemetryService(t);
		captureConversationTurnEvent(tSvc, {
			ulid: "ulid-smoke-task-1",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			source: "user",
			mode: "act",
		});
		captureConversationTurnEvent(tSvc, {
			ulid: "ulid-smoke-task-1",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			source: "assistant",
			mode: "act",
		});
		dumpEvents(t.events);
		const turns = t.events.filter((e) => e.name === "task.conversation_turn");
		const userTurns = turns.filter((e) => e.properties?.source === "user");
		const assistantTurns = turns.filter(
			(e) => e.properties?.source === "assistant",
		);
		const allHaveTimestamp = turns.every(
			(e) => typeof e.properties?.timestamp === "string",
		);
		console.log(
			`emitted ${turns.length} task.conversation_turn event(s); expected 2 (1 user + 1 assistant).`,
		);
		console.log(
			`  user=${userTurns.length} assistant=${assistantTurns.length} all_have_timestamp=${allHaveTimestamp}`,
		);
		assertSmoke("task.conversation_turn count", turns.length, 2);
		assertSmoke("task.conversation_turn user count", userTurns.length, 1);
		assertSmoke(
			"task.conversation_turn assistant count",
			assistantTurns.length,
			1,
		);
		assertSmoke(
			"task.conversation_turn timestamps populated",
			allHaveTimestamp,
			true,
		);
	}

	header(
		"task.completed source=submit_and_exit (assistant declared completion)",
	);
	{
		const t = new CapturingTelemetry();
		captureTaskCompleted(asITelemetryService(t), {
			ulid: "ulid-smoke-task-1",
			provider: "anthropic",
			modelId: "claude-sonnet-4-5",
			mode: "act",
			durationMs: 12_345,
			source: "submit_and_exit",
		});
		dumpEvents(t.events);
		const completed = t.events.filter((e) => e.name === "task.completed");
		const submitSourced = completed.filter(
			(e) => e.properties?.source === "submit_and_exit",
		);
		console.log(
			`emitted ${completed.length} task.completed event(s); expected 1 with source="submit_and_exit" (got ${submitSourced.length}).`,
		);
		assertSmoke("task.completed (submit_and_exit) count", completed.length, 1);
		assertSmoke(
			"task.completed source=submit_and_exit count",
			submitSourced.length,
			1,
		);
	}

	header(
		"task.completed source=shutdown (non-interactive fallback when submit_and_exit was not observed)",
	);
	{
		const t = new CapturingTelemetry();
		captureTaskCompleted(asITelemetryService(t), {
			ulid: "ulid-smoke-task-2",
			provider: "anthropic",
			modelId: "claude-sonnet-4-5",
			mode: "act",
			durationMs: 9_876,
			source: "shutdown",
		});
		dumpEvents(t.events);
		const completed = t.events.filter((e) => e.name === "task.completed");
		const shutdownSourced = completed.filter(
			(e) => e.properties?.source === "shutdown",
		);
		console.log(
			`emitted ${completed.length} task.completed event(s); expected 1 with source="shutdown" (got ${shutdownSourced.length}).`,
		);
		assertSmoke("task.completed (shutdown) count", completed.length, 1);
		assertSmoke(
			"task.completed source=shutdown count",
			shutdownSourced.length,
			1,
		);
	}

	header(
		"task lifecycle in order: created → conversation_turn × 2 → completed (single capturing telemetry)",
	);
	{
		const t = new CapturingTelemetry();
		const tSvc = asITelemetryService(t);
		const ulid = "ulid-smoke-task-lifecycle";
		captureTaskCreated(tSvc, {
			ulid,
			apiProvider: "anthropic",
		});
		captureConversationTurnEvent(tSvc, {
			ulid,
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			source: "user",
			mode: "act",
		});
		captureConversationTurnEvent(tSvc, {
			ulid,
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			source: "assistant",
			mode: "act",
		});
		captureTaskCompleted(tSvc, {
			ulid,
			provider: "anthropic",
			modelId: "claude-sonnet-4-5",
			mode: "act",
			durationMs: 4_242,
			source: "submit_and_exit",
		});
		dumpEvents(t.events);
		const order = t.events.map((e) => e.name);
		const expectedOrder = [
			"task.created",
			"task.conversation_turn",
			"task.conversation_turn",
			"task.completed",
		];
		const orderOk =
			order.length === expectedOrder.length &&
			order.every((name, idx) => name === expectedOrder[idx]);
		console.log(
			`event order: [${order.join(", ")}]; expected [${expectedOrder.join(", ")}]; ok=${orderOk}.`,
		);
		assertSmoke("task lifecycle event order", orderOk, true);
	}

	header("Done");
}

main().catch((err) => {
	console.error("smoke test failed:", err);
	process.exitCode = 1;
});
