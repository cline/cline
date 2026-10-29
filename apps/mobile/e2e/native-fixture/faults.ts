/** Explicit test-proxy controls; never imported by production code. */
export const FAULTS = new Set([
	"auth-pending",
	"auth-expired",
	"auth-error",
	"auth-authorize-error",
	"auth-short-credentials",
	"auth-refresh-invalid",
	"accounts-error",
	"account-switch-error",
	"account-switch-delay-ms",
	"list-delay-ms",
	"create-delay-ms",
	"create-pending-ms",
	"create-error",
	"create-ambiguous",
	"list-error",
	"list-empty",
	"repositories-error",
	"repositories-empty",
	"repositories-delay-ms",
	"branches-error",
	"branches-empty",
	"branches-delay-ms",
	"models-error",
	"balance-error",
	"history-error",
	"details-error",
	"status-error",
	"status-auth-error",
	"mutation-delay-ms",
	"rename-error",
	"delete-error",
	"suspend-error",
	"resume-error",
	"hydrate-error",
	"abort-error",
	"approval-error",
	"question-error",
	"send-error",
	"reasoning-error",
	"queue-error",
	"catalog-error",
	"drop-replies",
]);
export class FixtureFaults {
	private scopes = new Map<string, Map<string, number>>();
	set(scope: string, fault: string, value: number) {
		if (
			["auth-short-credentials", "auth-refresh-invalid"].includes(fault) &&
			(scope !== "global" || (value !== 0 && value !== 1))
		)
			throw new Error(`${fault} requires global scope and value0 or1`);
		if (
			["status-auth-error", "mutation-delay-ms"].includes(fault) &&
			(!scope.trim() || scope === "global")
		)
			throw new Error(`${fault} requires an exact workspace id`);
		if (
			!FAULTS.has(fault) ||
			!Number.isFinite(value) ||
			value < 0 ||
			value > 60000
		)
			throw new Error("Unknown fault or invalid value (0–60000)");
		const controls = this.scopes.get(scope) ?? new Map<string, number>();
		controls.set(fault, value);
		this.scopes.set(scope, controls);
	}
	get(scope: string, fault: string): number {
		return (
			this.scopes.get(scope)?.get(fault) ??
			this.scopes.get("global")?.get(fault) ??
			0
		);
	}
	clear(scope: string) {
		this.scopes.delete(scope);
	}
	view() {
		return Object.fromEntries(
			[...this.scopes].map(([scope, values]) => [
				scope,
				Object.fromEntries(values),
			]),
		);
	}
}

/** The same scoped HTTP401 response is used by the proxy and Gateway contract test. */
export function fixtureStatusAuthenticationFailure(
	faults: FixtureFaults,
	workspaceId: string,
): Response | undefined {
	return faults.get(workspaceId, "status-auth-error")
		? Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
		: undefined;
}

/** Observe admission before holding only an exact workspace's management mutation. */
export async function holdFixtureWorkspaceMutation(input: {
	faults: FixtureFaults;
	id: string;
	method: string;
	action?: string;
	record(
		kind: string,
		detail: { id: string; method: string; action: string },
	): void;
	sleep(milliseconds: number): Promise<unknown>;
}): Promise<void> {
	const action =
		!input.action && input.method === "PATCH"
			? "rename"
			: !input.action && input.method === "DELETE"
				? "delete"
				: input.method === "POST" &&
						(input.action === "suspend" || input.action === "resume")
					? input.action
					: undefined;
	if (!action) return;
	input.record("workspace-mutation-requested", {
		id: input.id,
		method: input.method,
		action,
	});
	const delay = input.faults.get(input.id, "mutation-delay-ms");
	if (delay) await input.sleep(delay);
}
export function commandFault(command: string) {
	if (command === "session.messages") return "hydrate-error";
	if (command === "run.abort") return "abort-error";
	if (command === "approval.respond") return "approval-error";
	if (command === "capability.respond") return "question-error";
	if (command === "session.send_input") return "send-error";
	if (command === "session.update_connection") return "reasoning-error";
	if (command === "catalog.list") return "catalog-error";
	if (/pending_prompt|steer/.test(command)) return "queue-error";
	return undefined;
}
