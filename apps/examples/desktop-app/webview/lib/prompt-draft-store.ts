type PendingSend = {
	text: string;
	attachments: File[];
	revision: number;
};

type DraftEntry = {
	text: string;
	revision: number;
	pending?: PendingSend;
	recoveredAttachments: File[];
};

export type PromptSendAttempt = {
	/**
	 * Finishes one send. Returns true only when its prompt was restored: the
	 * runtime rejected it, the thread still exists, and the user has not edited,
	 * replaced, or re-sent anything since the composer was cleared.
	 */
	settle(accepted: boolean): boolean;
};

/**
 * App-owned, in-memory prompt state for chat threads. Panes are keyed and
 * unmount during navigation, so unsent text and failed-send recovery cannot
 * live in them. Keystrokes use `edit` and notify no one; external changes use
 * `replace` and notify the mounted composer.
 */
export class PromptDraftStore {
	private readonly entries = new Map<string, DraftEntry>();
	private readonly draftListeners = new Map<
		string,
		Set<(value: string) => void>
	>();
	private readonly attachmentListeners = new Map<
		string,
		Set<(files: File[]) => void>
	>();
	// Monotonic across entries, so a deleted and recreated draft can't reuse a
	// revision that an older send is still waiting to compare.
	private clock = 0;

	getDraft(threadId: string): string {
		return this.entries.get(threadId)?.text ?? "";
	}

	/** A user edit, or the composer acknowledging an external replacement. */
	edit(threadId: string, value: string): void {
		if (this.getDraft(threadId) === value) return;
		this.write(threadId, value);
	}

	/**
	 * An external replacement. It is always applied to the visible composer and
	 * supersedes pending sends, even when the stored string is unchanged.
	 */
	replace(threadId: string, value: string): void {
		this.write(threadId, value);
		for (const listener of this.draftListeners.get(threadId) ?? []) {
			listener(value);
		}
	}

	/** Clears the draft for a send and remembers what to recover if it fails. */
	beginSend(
		threadId: string,
		text: string,
		attachments: readonly File[],
	): PromptSendAttempt {
		this.replace(threadId, "");
		const entry = this.entries.get(threadId) ?? this.create(threadId);
		const pending: PendingSend = {
			text,
			attachments: [...attachments],
			revision: entry.revision,
		};
		entry.pending = pending;
		return { settle: (accepted) => this.settle(threadId, pending, accepted) };
	}

	subscribe(threadId: string, listener: (value: string) => void): () => void {
		return this.addListener(this.draftListeners, threadId, listener);
	}

	/** Receives attachments from a failed send, including any already waiting. */
	subscribeAttachments(
		threadId: string,
		listener: (files: File[]) => void,
	): () => void {
		const unsubscribe = this.addListener(
			this.attachmentListeners,
			threadId,
			listener,
		);
		const entry = this.entries.get(threadId);
		if (entry && entry.recoveredAttachments.length > 0) {
			const files = entry.recoveredAttachments;
			entry.recoveredAttachments = [];
			this.cleanup(threadId, entry);
			listener(files);
		}
		return unsubscribe;
	}

	/** Drops state for threads that no longer exist, including pending sends. */
	prune(liveThreadIds: ReadonlySet<string>): void {
		for (const threadId of [...this.entries.keys()]) {
			if (!liveThreadIds.has(threadId)) this.entries.delete(threadId);
		}
	}

	private settle(
		threadId: string,
		pending: PendingSend,
		accepted: boolean,
	): boolean {
		const entry = this.entries.get(threadId);
		if (!entry || entry.pending !== pending) return false;
		entry.pending = undefined;
		if (
			accepted ||
			entry.revision !== pending.revision ||
			entry.text.trim() !== ""
		) {
			this.cleanup(threadId, entry);
			return false;
		}
		this.replace(threadId, pending.text);
		this.deliverAttachments(threadId, pending.attachments);
		return true;
	}

	private deliverAttachments(threadId: string, files: File[]): void {
		if (files.length === 0) return;
		const listeners = this.attachmentListeners.get(threadId);
		if (listeners && listeners.size > 0) {
			for (const listener of listeners) listener(files);
			return;
		}
		const entry = this.entries.get(threadId) ?? this.create(threadId);
		entry.recoveredAttachments.push(...files);
	}

	private write(threadId: string, value: string): void {
		const existing = this.entries.get(threadId);
		if (!existing && !value) return;
		const entry = existing ?? this.create(threadId);
		entry.text = value;
		entry.revision = ++this.clock;
		this.cleanup(threadId, entry);
	}

	private create(threadId: string): DraftEntry {
		const entry: DraftEntry = {
			text: "",
			revision: ++this.clock,
			recoveredAttachments: [],
		};
		this.entries.set(threadId, entry);
		return entry;
	}

	private cleanup(threadId: string, entry: DraftEntry): void {
		if (
			!entry.text &&
			!entry.pending &&
			entry.recoveredAttachments.length === 0 &&
			this.entries.get(threadId) === entry
		) {
			this.entries.delete(threadId);
		}
	}

	private addListener<T>(
		listeners: Map<string, Set<T>>,
		threadId: string,
		listener: T,
	): () => void {
		const threadListeners = listeners.get(threadId) ?? new Set<T>();
		threadListeners.add(listener);
		listeners.set(threadId, threadListeners);
		return () => {
			threadListeners.delete(listener);
			if (
				threadListeners.size === 0 &&
				listeners.get(threadId) === threadListeners
			) {
				listeners.delete(threadId);
			}
		};
	}
}
