import type {
	ConnectorBindingStore,
	ConnectorThreadState,
} from "./thread-bindings";

/**
 * Which conversations a connector must subscribe to again when it starts.
 *
 * Subscriptions live in the chat library's in-memory state, so every restart forgets them. In a
 * group that is not a small thing: `onSubscribedMessage` never fires for an unsubscribed thread
 * and `onNewMention` needs an @-mention, so ordinary messages -- including a reply to something
 * the bot itself posted -- are dropped with no log at all. Until someone happens to send a slash
 * command or a mention, which do subscribe, the conversation looks dead.
 *
 * The bindings file is the honest record of which conversations this connector serves, so it is
 * what the subscriptions are rebuilt from. Direct messages are left out: they arrive without a
 * subscription, so re-subscribing them would be noise.
 */
export function collectThreadKeysToResubscribe<
	TState extends ConnectorThreadState,
>(bindings: ConnectorBindingStore<TState> | Record<string, unknown>): string[] {
	const keys: string[] = [];
	for (const [key, value] of Object.entries(bindings)) {
		const binding = value as
			| { kind?: string; isDM?: boolean; serializedThread?: string }
			| undefined;
		if (!binding?.serializedThread || binding.isDM !== false) {
			continue;
		}
		// Mute rows and participant rows are bookkeeping about a conversation, not one to join.
		if (binding.kind !== undefined && binding.kind !== "conversation") {
			continue;
		}
		keys.push(key);
	}
	return keys;
}
