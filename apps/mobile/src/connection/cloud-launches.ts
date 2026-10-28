import {
	type AttentionChange,
	type AttentionKind,
	attentionChanges,
} from "@/notifications/attention-events";
import type {
	ApprovalPolicy,
	RemoteSession,
	RunStatus,
	SessionInputAttachments,
	SessionViewModel,
} from "../session";
import {
	SessionConnectionController,
	type SessionConnectionControllerDeps,
} from "./controller";
import { type ConnectionDescriptor, descriptorKey } from "./endpoints";

export type AttentionEvent =
	| { type: "clear" }
	| {
			type: "attention";
			id: string;
			kind: AttentionKind;
			endpointKey: string;
			remoteSessionId: string;
			sessionId: string;
			focused: boolean;
	  };

interface Launch {
	key: string;
	descriptor: ConnectionDescriptor;
	retained?: boolean;
	previousView?: SessionViewModel;
	pendingAttention?: {
		windowId: number;
		changes: Map<string, AttentionChange>;
	};
	controller: SessionConnectionController;
	viewers: number;
	opened: boolean;
	sending: boolean;
	unsubscribe(): void;
}

function hasPendingWork(view: SessionViewModel): boolean {
	return (
		view.runStatus === "running" ||
		view.pendingApprovals.length > 0 ||
		view.pendingQuestions.length > 0 ||
		view.pendingPrompts.length > 0 ||
		view.messages.some((message) => message.failed)
	);
}

/** Retain opened sessions across navigation; never connect an unopened workspace. */
export class CloudLaunches {
	private attentionFocus?: { key: string };
	private readonly attentionListeners = new Set<
		(event: AttentionEvent) => void
	>();
	subscribeAttention = (listener: (event: AttentionEvent) => void) => {
		this.attentionListeners.add(listener);
		return () => {
			this.attentionListeners.delete(listener);
		};
	};
	focusForAttention(descriptor: ConnectionDescriptor): () => void {
		const focus = { key: descriptorKey(descriptor) };
		this.attentionFocus = focus;
		return () => {
			if (this.attentionFocus === focus) this.attentionFocus = undefined;
		};
	}
	isAttentionFocused = (key: string): boolean =>
		this.attentionFocus?.key === key;
	private emitAttention(event: AttentionEvent): void {
		for (const listener of this.attentionListeners) {
			try {
				listener(event);
			} catch {
				/* Alerts cannot interrupt the task. */
			}
		}
	}
	private readonly launches = new Map<string, Launch>();
	private nextLocalLaunch = 0;
	private readonly listeners = new Set<() => void>();
	private statuses: Readonly<Record<string, RunStatus>> = {};
	private unread: ReadonlySet<string> = new Set();
	getStatuses = () => this.statuses;
	getUnread = () => this.unread;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(unreadChanged = false): void {
		const next: Record<string, RunStatus> = {};
		for (const [key, entry] of this.launches) {
			const snapshot = entry.controller.getSnapshot();
			if (
				snapshot.status.phase === "ready" &&
				snapshot.view.connectionStatus === "live"
			)
				next[key] = snapshot.view.runStatus;
		}
		if (
			Object.keys(next).length === Object.keys(this.statuses).length &&
			Object.keys(next).every((key) => next[key] === this.statuses[key])
		) {
			if (unreadChanged) for (const listener of this.listeners) listener();
			return;
		}
		this.statuses = next;
		for (const listener of this.listeners) listener();
	}

	private subscribeTranscriptAttention(entry: Launch): () => void {
		return entry.controller.subscribeTranscriptAttention((event) => {
			if (this.launches.get(entry.key) !== entry) return;
			if (event.type === "started") {
				entry.pendingAttention = {
					windowId: event.windowId,
					changes: new Map(),
				};
				return;
			}
			const pending = entry.pendingAttention;
			if (!pending || pending.windowId !== event.windowId) return;
			if (event.type === "observed") {
				if (pending.changes.size < 256)
					pending.changes.set(event.change.id, event.change);
				return;
			}
			entry.pendingAttention = undefined;
			if (event.type !== "ready") return;
			const snapshot = entry.controller.getSnapshot();
			const view = snapshot.view;
			if (
				snapshot.status.phase !== "ready" ||
				view.connectionStatus !== "live" ||
				entry.descriptor.mode !== "cloud" ||
				!entry.descriptor.remoteSessionId ||
				!snapshot.sessionId
			)
				return;
			for (const change of pending.changes.values()) {
				// A request resolved while history was loading no longer needs attention.
				const relevant =
					change.kind === "question"
						? view.pendingQuestions.some(
								(q) => change.id === `question:${q.requestId}`,
							)
						: change.kind === "approval"
							? view.pendingApprovals.some(
									(a) => change.id === `approval:${a.approvalId}`,
								)
							: change.kind === "completed"
								? view.runStatus === "completed" &&
									view.pendingPrompts.length === 0
								: view.runStatus === "failed";
				if (relevant)
					this.emitAttention({
						type: "attention",
						...change,
						id: `${entry.key}:${snapshot.sessionId}:${change.id}`,
						endpointKey: entry.key,
						remoteSessionId: entry.descriptor.remoteSessionId,
						sessionId: snapshot.sessionId,
						focused: this.isAttentionFocused(entry.key),
					});
			}
		});
	}

	private observe(key: string, entry: Launch): void {
		if (this.launches.get(key) !== entry) return;
		const snapshot = entry.controller.getSnapshot();
		const previous = entry.previousView;
		const view = snapshot.view;
		entry.previousView = view;
		if (
			entry.descriptor.mode === "cloud" &&
			entry.descriptor.remoteSessionId &&
			snapshot.sessionId &&
			snapshot.status.phase === "ready"
		) {
			for (const change of attentionChanges(previous, view)) {
				this.emitAttention({
					type: "attention",
					...change,
					id: `${key}:${snapshot.sessionId}:${change.id}`,
					endpointKey: key,
					remoteSessionId: entry.descriptor.remoteSessionId,
					sessionId: snapshot.sessionId,
					focused: this.attentionFocus?.key === key,
				});
			}
		}
		// Hydration/reconnect is not new activity. Compare the reducer's stable
		// block arrays, not message wrappers (projection rebuilds those every time).
		const markUnread =
			!entry.viewers &&
			!this.unread.has(key) &&
			snapshot.status.phase === "ready" &&
			previous?.connectionStatus === "live" &&
			view.connectionStatus === "live" &&
			(previous.runStatus !== view.runStatus ||
				previous.messages.length !== view.messages.length ||
				view.messages.some(
					(message, index) =>
						message.blocks !== previous.messages[index]?.blocks ||
						message.failed !== previous.messages[index]?.failed,
				) ||
				view.pendingQuestions.some(
					(question) =>
						!previous.pendingQuestions.some(
							(old) => old.requestId === question.requestId,
						),
				) ||
				view.pendingApprovals.some(
					(approval) =>
						!previous.pendingApprovals.some(
							(old) => old.approvalId === approval.approvalId,
						),
				));
		if (markUnread) this.unread = new Set([...this.unread, key]);
		this.publish(markUnread);
	}

	private markRead(key: string): void {
		if (!this.unread.has(key)) return;
		const next = new Set(this.unread);
		next.delete(key);
		this.unread = next;
		this.publish(true);
	}

	constructor(
		private readonly createController = (
			descriptor: ConnectionDescriptor,
			deps: SessionConnectionControllerDeps,
		) => new SessionConnectionController(descriptor, deps),
	) {}

	async start(input: {
		descriptor: ConnectionDescriptor;
		message: string;
		attachments?: SessionInputAttachments;
		deps: SessionConnectionControllerDeps;
		save(descriptor: ConnectionDescriptor): Promise<void>;
		subscribePolicy?(listener: (policy: ApprovalPolicy) => void): () => void;
	}): Promise<ConnectionDescriptor> {
		const key = descriptorKey(input.descriptor);
		if (this.launches.has(key))
			throw new Error("This conversation is already starting.");
		const controller = this.createController(input.descriptor, input.deps);
		const entry: Launch = {
			key,
			descriptor: input.descriptor,
			controller,
			viewers: 0,
			opened: false,
			sending: true,
			unsubscribe: () => {},
		};
		this.launches.set(key, entry);
		const assertCurrent = () => {
			if (this.launches.get(key) !== entry)
				throw new Error("Cloud start cancelled.");
		};
		try {
			let unsubscribeView = () => {};
			const unsubscribePolicy = input.subscribePolicy?.(
				controller.setApprovalPolicy,
			);
			const unsubscribeAttention = this.subscribeTranscriptAttention(entry);
			entry.unsubscribe = () => {
				unsubscribeAttention();
				unsubscribeView();
				unsubscribePolicy?.();
			};
			await controller.start();
			assertCurrent();
			// Clear the durable resend intent BEFORE dispatch, just as the chat route does.
			// A storage failure must not send a prompt that a relaunch could send twice.
			const descriptor = { ...input.descriptor };
			delete descriptor.pendingInitialMessage;
			await input.save(descriptor);
			assertCurrent();
			let pinned: string | undefined;
			entry.previousView = controller.getSnapshot().view;
			unsubscribeView = controller.subscribe(() => {
				this.observe(key, entry);
				if (!entry.sending && !entry.viewers) this.releaseIfUnused(entry);
				const sessionId = controller.getSnapshot().sessionId;
				if (!sessionId || sessionId === pinned) return;
				pinned = sessionId;
				descriptor.hubSessionId = sessionId;
				delete descriptor.allowInitialCreate;
				void input.save({ ...descriptor }).catch(() => {});
			});
			this.publish();
			// sendInput resolves when the turn finishes, not when the message is accepted.
			// Keep this SAME controller alive for approvals and for the eventual chat view.
			void controller
				.sendInput(input.message, input.attachments)
				.finally(() => {
					entry.sending = false;
					this.releaseIfUnused(entry);
				});
			return descriptor;
		} catch (error) {
			if (this.launches.get(key) === entry) this.launches.delete(key);
			entry.unsubscribe();
			controller.dispose();
			this.publish();
			throw error;
		}
	}

	/** New local sessions use a temporary key until the Hub assigns their exact ID. */
	open(
		descriptor: ConnectionDescriptor,
		deps: SessionConnectionControllerDeps = {},
	) {
		if (descriptor.mode === "cloud" && deps.createNewSession) return undefined;
		const key =
			descriptor.mode === "local" &&
			(!descriptor.hubSessionId || deps.createNewSession)
				? `local-pending:${++this.nextLocalLaunch}`
				: descriptorKey(descriptor);
		let entry = this.launches.get(key);
		if (
			entry &&
			(entry.controller.getSnapshot().status.phase === "closed" ||
				entry.descriptor.organizationId !== descriptor.organizationId ||
				entry.descriptor.authToken !== descriptor.authToken ||
				entry.descriptor.credentialKind !== descriptor.credentialKind ||
				entry.descriptor.hubPublicKey !== descriptor.hubPublicKey ||
				entry.descriptor.devicePrivateKey !== descriptor.devicePrivateKey ||
				entry.descriptor.transport !== descriptor.transport ||
				entry.descriptor.remoteSessionId !== descriptor.remoteSessionId ||
				entry.descriptor.apiBaseUrl !== descriptor.apiBaseUrl ||
				(descriptor.hubSessionId &&
					entry.controller.getSnapshot().sessionId &&
					descriptor.hubSessionId !== entry.controller.getSnapshot().sessionId))
		) {
			this.remove(key);
			entry = undefined;
		}
		if (!entry) {
			// Preserve the chat route's durable first-send guard for legacy launches.
			if (descriptor.pendingInitialMessage) return undefined;
			const controller = this.createController(descriptor, deps);
			entry = {
				key,
				descriptor,
				controller,
				viewers: 0,
				opened: false,
				sending: false,
				unsubscribe: () => {},
			};
			this.launches.set(key, entry);
			const unsubscribeAttention = this.subscribeTranscriptAttention(entry);
			const unsubscribeView = controller.subscribe(() => {
				this.pinLocalSession(entry!);
				this.observe(entry!.key, entry!);
				this.releaseIfUnused(entry!);
			});
			entry.unsubscribe = () => {
				unsubscribeView();
				unsubscribeAttention();
			};
		}
		entry.retained = true;
		// Map order is last-opened order, not message-arrival order.
		this.launches.delete(key);
		this.launches.set(key, entry);
		const lease = this.acquireEntry(entry);
		this.trimIdle();
		return lease;
	}

	/** A checkpoint fork keeps the socket that owns its question capability. */
	retain(
		descriptor: ConnectionDescriptor,
		controller: SessionConnectionController,
	): void {
		const key = descriptorKey(descriptor);
		if (this.launches.has(key))
			throw new Error("This conversation is already open.");
		const entry: Launch = {
			key,
			descriptor,
			controller,
			retained: true,
			viewers: 0,
			opened: true,
			sending: false,
			unsubscribe: () => {},
		};
		this.launches.set(key, entry);
		const unsubscribeAttention = this.subscribeTranscriptAttention(entry);
		const unsubscribeView = controller.subscribe(() => {
			this.observe(key, entry);
			this.releaseIfUnused(entry);
		});
		entry.unsubscribe = () => {
			unsubscribeView();
			unsubscribeAttention();
		};
		this.observe(key, entry);
		this.trimIdle(entry);
	}

	remove(key: string): void {
		this.markRead(key);
		this.disposeEntry(key);
	}

	private disposeEntry(key: string): void {
		const entry = this.launches.get(key);
		if (!entry) return;
		this.launches.delete(key);
		entry.unsubscribe();
		entry.controller.dispose();
		this.publish();
	}

	/** Reopening an unavailable workspace must recheck its lifecycle before connecting. */
	reconcile(sessions: readonly RemoteSession[]): void {
		for (const session of sessions) {
			if (
				!["expired", "failed", "stopped", "suspended"].includes(session.status)
			)
				continue;
			const key = descriptorKey({ mode: "cloud", url: session.sandboxUrl });
			const entry = this.launches.get(key);
			if (
				entry &&
				!entry.viewers &&
				!entry.sending &&
				entry.descriptor.organizationId === session.organizationId
			)
				this.disposeEntry(key);
		}
	}

	private trimIdle(protectedEntry?: Launch): void {
		// Keep a small recent working set; never evict an in-flight send or question.
		for (const [key, entry] of this.launches) {
			if (this.launches.size <= 8) break;
			const view = entry.controller.getSnapshot().view;
			if (
				entry !== protectedEntry &&
				!entry.viewers &&
				!entry.sending &&
				entry.opened &&
				!hasPendingWork(view)
			)
				this.disposeEntry(key);
		}
	}

	acquire(descriptor: ConnectionDescriptor):
		| {
				controller: SessionConnectionController;
				release(): void;
		  }
		| undefined {
		const key = descriptorKey(descriptor);
		const entry = this.launches.get(key);
		if (!entry) return undefined;
		return this.acquireEntry(entry);
	}

	private pinLocalSession(entry: Launch): void {
		if (entry.descriptor.mode !== "local") return;
		const sessionId = entry.controller.getSnapshot().sessionId;
		if (!sessionId || entry.descriptor.hubSessionId === sessionId) return;
		const descriptor = { ...entry.descriptor, hubSessionId: sessionId };
		const key = descriptorKey(descriptor);
		// A separate live viewer of the exact session owns its own capabilities.
		// Keep both sockets alive rather than replace that viewer's controller.
		if (this.launches.has(key)) return;
		this.launches.delete(entry.key);
		if (this.unread.has(entry.key)) {
			const unread = new Set(this.unread);
			unread.delete(entry.key);
			unread.add(key);
			this.unread = unread;
		}
		entry.key = key;
		entry.descriptor = descriptor;
		this.launches.set(key, entry);
	}

	private acquireEntry(entry: Launch) {
		entry.viewers += 1;
		entry.opened = true;
		this.markRead(entry.key);
		let released = false;
		return {
			controller: entry.controller,
			release: () => {
				if (released) return;
				released = true;
				entry.viewers -= 1;
				this.releaseIfUnused(entry);
			},
		};
	}

	clear(): void {
		this.attentionFocus = undefined;
		this.emitAttention({ type: "clear" });
		for (const entry of this.launches.values()) {
			entry.unsubscribe();
			entry.controller.dispose();
		}
		this.launches.clear();
		this.unread = new Set();
		this.publish(true);
	}

	private releaseIfUnused(entry: Launch): void {
		// A blank local route gets a fresh temporary key on remount, so there is
		// no lease to reclaim. Cancel its bootstrap before it creates a socket.
		if (
			entry.key.startsWith("local-pending:") &&
			!entry.viewers &&
			!entry.sending &&
			entry.controller.getSnapshot().status.phase === "connecting" &&
			!entry.controller.getSnapshot().sessionId
		) {
			this.disposeEntry(entry.key);
			return;
		}
		// Defer through Strict Mode's cleanup/remount so it can reclaim the controller.
		queueMicrotask(() => {
			if (
				this.launches.get(entry.key) !== entry ||
				entry.viewers ||
				entry.sending ||
				!entry.opened
			)
				return;
			const view = entry.controller.getSnapshot().view;
			// Keep an unconfirmed send's existing retry bubble; never silently resend it.
			if (hasPendingWork(view)) return;
			if (
				entry.descriptor.mode === "local" &&
				!entry.controller.getSnapshot().sessionId
			) {
				this.disposeEntry(entry.key);
				return;
			}
			if (entry.retained) {
				if (
					["error", "closed"].includes(
						entry.controller.getSnapshot().status.phase,
					)
				)
					this.disposeEntry(entry.key);
				else this.trimIdle();
				return;
			}
			this.disposeEntry(entry.key);
		});
	}
}

export const cloudLaunches = new CloudLaunches();
