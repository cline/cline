import type { ModelCatalogView, SessionCheckpoint } from "@/session";
import type { ReasoningChoice } from "@/session/reasoning";
/**
 * The single hook a chat screen calls to talk to a hub.
 *
 * It is deliberately thin: all of the logic lives in {@link
 * SessionConnectionController} (pure, unit-tested), and this only binds one
 * controller instance to a component's lifecycle and re-renders on its snapshot.
 *
 * Views borrow a retained controller so
 * switching screens preserves live sidebar status, startup, and pending work.
 * Rotating credentials or selecting a different inner session replaces it;
 * requesting a new local session still gets its own controller.
 * The connect/hydrate handshake and any
 * reconnection run inside the controller; the hook just surfaces `view`, `status`
 * and the write operations.
 */

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { ApprovalPolicy, SessionInputAttachments } from "../session";
import { cloudLaunches } from "./cloud-launches";
import {
	type ConnectionSnapshot,
	initialSnapshot,
	SessionConnectionController,
	type SessionConnectionControllerDeps,
} from "./controller";
import type { ConnectionDescriptor } from "./endpoints";

export interface UseSessionConnection {
	pendingReasoning?: ReasoningChoice;
	view: ConnectionSnapshot["view"];
	status: ConnectionSnapshot["status"];
	/** Prescribed branch from the resolved Cloud workspace; not a live git lookup. */
	taskBranch?: string;
	/** Exact inner Hub session selected or created by this connection. */
	sessionId?: string;
	sendInput(text: string, attachments?: SessionInputAttachments): Promise<void>;
	abort(reason?: string): Promise<void>;
	respondApproval(
		approvalId: string,
		approved: boolean,
		reason?: string,
	): Promise<void>;
	respondQuestion(requestId: string, answer: string): Promise<void>;
	retrySend(messageId: string): Promise<void>;
	/** Drop a prompt the machine is still holding in its turn queue. */
	removePendingPrompt(promptId: string): Promise<void>;
	/** Edit a queued prompt, or promote it with `delivery: "steer"`. */
	updatePendingPrompt(
		promptId: string,
		changes: { prompt?: string; delivery?: "queue" | "steer" },
	): Promise<void>;
	/** Change the model on this exact live session. */
	updateModel(
		modelId: string,
		options?: { providerId?: string },
	): Promise<void>;
	/** The connected machine's model catalog (`catalog.list`). */
	listModelCatalog(): Promise<ModelCatalogView>;
	listCheckpoints(): Promise<readonly SessionCheckpoint[]>;
	forkAtCheckpoint(runCount: number): Promise<string>;
	reconnect(): Promise<void>;
	/** Push a new auto-approve policy at the live session (Settings toggles). */
	setApprovalPolicy(policy: ApprovalPolicy): void;
	setReasoningChoice?(choice: ReasoningChoice | undefined): void;
	dispose(): void;
}

const NOOP_ASYNC = (): Promise<void> => Promise.resolve();

export function useSessionConnection(
	descriptor: ConnectionDescriptor,
	deps?: SessionConnectionControllerDeps,
): UseSessionConnection {
	const controllerRef = useRef<SessionConnectionController | null>(null);
	const focusHistory = useRef<
		| {
				controller: SessionConnectionController;
				generation: number;
				left: boolean;
				needsRecovery: boolean;
		  }
		| undefined
	>(undefined);
	// A pure idle snapshot — no controller is constructed here. Building one just
	// for the seed value would risk a second HubClient (and Strict Mode invokes
	// this initializer too); the sole controller is created in the effect below.
	const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(initialSnapshot);

	// Credentials are part of connection identity even though descriptorKey omits
	// them for saved-endpoint de-duplication. A rotated token must rebuild the socket.
	useEffect(() => {
		const launch = cloudLaunches.open(descriptor, deps);
		const controller =
			launch?.controller ?? new SessionConnectionController(descriptor, deps);
		controllerRef.current = controller;
		setSnapshot(controller.getSnapshot());
		const unsubscribe = controller.subscribe(() => {
			setSnapshot(controller.getSnapshot());
		});
		// Bootstrap failures are reflected in `status.phase === "error"`; the
		// rejection here has nowhere else to go.
		void controller.start().catch(() => {});
		return () => {
			unsubscribe();
			if (launch) launch.release();
			else controller.dispose();
			controllerRef.current = null;
		};
	}, [descriptor, deps]);

	useFocusEffect(
		// The controller follows descriptor/deps; resolved IDs enable health checks.
		// biome-ignore lint/correctness/useExhaustiveDependencies: deps replaces the retained controller even with unchanged session ID.
		useCallback(() => {
			const controller = controllerRef.current;
			if (descriptor.mode !== "cloud" || !controller) return;
			const previous = focusHistory.current;
			const returningToChat =
				previous?.controller === controller
					? previous.left || previous.needsRecovery
					: controller.getSnapshot().status.phase === "ready";
			const generation = (previous?.generation ?? 0) + 1;
			focusHistory.current = {
				controller,
				generation,
				left: false,
				needsRecovery: returningToChat,
			};
			let mounted = true;
			let previousAppState = AppState.currentState;
			let timer: ReturnType<typeof setInterval> | undefined;
			let recovery: Promise<void> | undefined;
			let recoveringHealth = false;
			let foregroundAfterHealth = false;
			const recover = (healthOnly: boolean) => {
				if (!mounted) return;
				if (recovery) {
					if (!healthOnly && recoveringHealth) foregroundAfterHealth = true;
					return;
				}
				recoveringHealth = healthOnly;
				// Never replay a prompt: only recover/read its exact session.
				recovery = (
					healthOnly ? controller.checkHealth() : controller.recoverFromIdle()
				)
					.catch(() => {})
					.finally(() => {
						recovery = undefined;
						recoveringHealth = false;
						if (foregroundAfterHealth && previousAppState === "active") {
							foregroundAfterHealth = false;
							recover(false);
						}
					});
			};
			const stopHealthChecks = () => {
				if (timer !== undefined) clearInterval(timer);
				timer = undefined;
			};
			const startHealthChecks = () => {
				if (timer !== undefined || !snapshot.sessionId) return;
				timer = setInterval(() => recover(true), 30_000);
			};
			if (previousAppState === "active") startHealthChecks();
			if (returningToChat && previousAppState === "active") {
				// Defer past Strict Mode's synchronous cleanup/remount. A retained
				// controller needs history recovery; a fresh bootstrap already hydrates.
				queueMicrotask(() => {
					if (!mounted) return;
					if (focusHistory.current?.generation === generation)
						focusHistory.current.needsRecovery = false;
					recover(false);
				});
			}
			const subscription = AppState.addEventListener("change", (state) => {
				const returningToApp =
					state === "active" &&
					(previousAppState === "background" ||
						previousAppState === "inactive");
				previousAppState = state;
				if (!mounted) return;
				if (state === "active") startHealthChecks();
				else stopHealthChecks();
				// iOS can suspend an OPEN socket without delivering its close event.
				if (returningToApp) recover(false);
			});
			return () => {
				mounted = false;
				stopHealthChecks();
				subscription.remove();
				queueMicrotask(() => {
					if (focusHistory.current?.generation === generation)
						focusHistory.current.left = true;
				});
			};
		}, [descriptor, deps, snapshot.sessionId]),
	);

	const sendInput = useCallback(
		(text: string, attachments?: SessionInputAttachments) =>
			controllerRef.current?.sendInput(text, attachments) ?? NOOP_ASYNC(),
		[],
	);
	const abort = useCallback(
		(reason?: string) => controllerRef.current?.abort(reason) ?? NOOP_ASYNC(),
		[],
	);
	const respondApproval = useCallback(
		(approvalId: string, approved: boolean, reason?: string) =>
			controllerRef.current?.respondApproval(approvalId, approved, reason) ??
			NOOP_ASYNC(),
		[],
	);
	const respondQuestion = useCallback(
		(requestId: string, answer: string) =>
			controllerRef.current?.respondQuestion(requestId, answer) ?? NOOP_ASYNC(),
		[],
	);
	const retrySend = useCallback(
		(messageId: string) =>
			controllerRef.current?.retrySend(messageId) ?? NOOP_ASYNC(),
		[],
	);
	const removePendingPrompt = useCallback(
		(promptId: string) =>
			controllerRef.current?.removePendingPrompt(promptId) ?? NOOP_ASYNC(),
		[],
	);
	const updatePendingPrompt = useCallback(
		(
			promptId: string,
			changes: { prompt?: string; delivery?: "queue" | "steer" },
		) =>
			controllerRef.current?.updatePendingPrompt(promptId, changes) ??
			NOOP_ASYNC(),
		[],
	);
	const reconnect = useCallback(
		() => controllerRef.current?.reconnect() ?? NOOP_ASYNC(),
		[],
	);
	const updateModel = useCallback(
		(modelId: string, options?: { providerId?: string }) =>
			controllerRef.current?.updateModel(modelId, options) ?? NOOP_ASYNC(),
		[],
	);
	const listModelCatalog = useCallback(() => {
		const controller = controllerRef.current;
		if (!controller) {
			return Promise.reject(new Error("Not connected yet."));
		}
		return controller.listModelCatalog();
	}, []);
	const listCheckpoints = useCallback(async () => {
		const controller = controllerRef.current;
		if (!controller) throw new Error("Not connected yet.");
		return controller.listCheckpoints();
	}, []);
	const forkAtCheckpoint = useCallback(async (runCount: number) => {
		const controller = controllerRef.current;
		if (!controller) throw new Error("Not connected yet.");
		const fork = await controller.forkAtCheckpoint(runCount);
		try {
			cloudLaunches.retain(fork.descriptor, fork.controller);
		} catch (error) {
			fork.controller.dispose();
			throw error;
		}
		return fork.sessionId;
	}, []);

	// Stable so a caller can list it in an effect's deps without re-running it on
	// every render.
	const setApprovalPolicy = useCallback((policy: ApprovalPolicy) => {
		controllerRef.current?.setApprovalPolicy(policy);
	}, []);
	const dispose = useCallback(() => controllerRef.current?.dispose(), []);
	const setReasoningChoice = useCallback(
		(choice: ReasoningChoice | undefined) => {
			controllerRef.current?.setReasoningChoice(choice);
		},
		[],
	);

	return {
		pendingReasoning: snapshot.pendingReasoning,
		...(snapshot.taskBranch ? { taskBranch: snapshot.taskBranch } : {}),
		view: snapshot.view,
		status: snapshot.status,
		...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}),
		sendInput,
		abort,
		respondApproval,
		respondQuestion,
		retrySend,
		removePendingPrompt,
		updatePendingPrompt,
		updateModel,
		listModelCatalog,
		listCheckpoints,
		forkAtCheckpoint,
		reconnect,
		setApprovalPolicy,
		setReasoningChoice,
		dispose,
	};
}
