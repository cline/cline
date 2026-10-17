import type {
	ConnectorBindingStore,
	ConnectorThreadState,
} from "./thread-bindings";

/**
 * Routing for hub `ui.notify` events, by the workspace the notification came from.
 *
 * A subscriber that knows only "something is ready" cannot deliver it: it can post to every
 * conversation, or pick whichever was most recently active. Both are wrong once more than one
 * workspace is in play, and both fail *silently* -- the message does arrive, just not where it
 * belongs, and nobody learns that the routing was a guess.
 *
 * So the rule here is deliberately strict: deliver only where the binding says this workspace
 * lives, and deliver nowhere when nothing says so. Silence is the honest answer to "I do not
 * know where this goes"; it is also recoverable, which a message in the wrong chat is not.
 *
 * The matching logic is pure and lives apart from any adapter, the same way
 * `schedule-delivery.ts` keeps delivery validation out of the adapters that post.
 */

export interface UiNotifySource {
	workspacePath?: string;
	itemId?: string;
}

function normalizePath(value: string | undefined): string {
	if (!value) {
		return "";
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	// A trailing separator names the same directory, and a binding written by hand often has
	// one. Comparing raw strings would make those two miss each other.
	return trimmed.length > 1 && trimmed.endsWith("/")
		? trimmed.slice(0, -1)
		: trimmed;
}

/**
 * Keys of every thread bound to the notification's workspace. Empty when the notification
 * carries no workspace, or when no thread is bound to it.
 *
 * More than one thread may legitimately be bound to the same workspace -- two chat topics over
 * one repository, for instance. All of them are correct targets; choosing between them would be
 * the guess this module exists to avoid.
 */
export function resolveNotifyTargets<TState extends ConnectorThreadState>(
	bindings: ConnectorBindingStore<TState> | Record<string, { state?: TState }>,
	source: UiNotifySource | undefined,
): string[] {
	const wanted = normalizePath(source?.workspacePath);
	if (!wanted) {
		return [];
	}

	const targets: string[] = [];
	for (const [key, binding] of Object.entries(bindings)) {
		const state = (binding as { state?: ConnectorThreadState } | undefined)
			?.state;
		if (!state) {
			continue;
		}
		// `workspaceRoot` is the repository; `cwd` may be a package inside it. A notification
		// about the repository belongs in a thread working anywhere within it.
		if (
			normalizePath(state.workspaceRoot) === wanted ||
			normalizePath(state.cwd) === wanted
		) {
			targets.push(key);
		}
	}
	return targets;
}

/**
 * Key under which a connector remembers the message it posted about one thing, so a later
 * notification about the same thing can update it instead of adding another.
 *
 * Returns nothing when the notification names no item: there is then nothing to supersede, and
 * guessing -- updating whatever was posted last in that conversation -- would overwrite an
 * unrelated message.
 */
export function resolveNotifyMessageKey(
	threadKey: string,
	itemId: string | undefined,
): string | undefined {
	const trimmed = itemId?.trim();
	if (!trimmed || !threadKey) {
		return undefined;
	}
	// A JSON pair cannot be forged by an id that merely looks like a joined key, which a
	// hand-picked separator character would allow.
	return JSON.stringify([threadKey, trimmed]);
}

/**
 * Whether the message just posted is the one a later notification should update.
 *
 * Only the running commentary is. It exists to be overwritten: a working task sends one of
 * those every few seconds, and editing the message it already has keeps that from becoming a
 * flood. A question and a finished-work notice are different in kind -- they are posted once,
 * they have to stay findable, and a question also carries the buttons that answer it.
 *
 * Remembering a question as the updatable message is how the progress line that arrives
 * moments later edits the question away: the text becomes `Running`, the keyboard goes with
 * it, and the card sits waiting on an answer nobody can give any more. Observed live -- the
 * question was replaced before the person had read it.
 */
export function shouldTrackForSuperseding(options: {
	supersedesPrevious?: boolean;
}): boolean {
	// Deliberately the flag itself, not "is this a question": a notice that does not claim to
	// supersede anything has no business becoming the thing that gets superseded.
	return options.supersedesPrevious === true;
}
