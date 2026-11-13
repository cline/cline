import type { CustomizeSection } from "@/components/views/customize/customize-sections";
import {
	createNavigationHistory,
	type NavigationHistory,
	navigationHistoryReducer,
} from "./navigation-history";
import type { SessionHistoryItem, SessionMetadata } from "./session-history";
import { sessionKey } from "./session-identity";

export type DesktopAppView =
	| "chat"
	| "sessions"
	| "settings"
	| "customize";

export type DesktopThread = {
	id: string;
	environmentId: string;
	historySession?: SessionHistoryItem;
	/** Live runtime session bound to the thread once a prompt has started it. */
	sessionId?: string;
	hasStarted?: boolean;
	initialPromptDraft?: string;
	initialAttachments?: File[];
};

export type DesktopAppLocation<SettingsSection extends string> = {
	activeThreadId: string;
	settingsSection: SettingsSection;
	customizeSection: CustomizeSection;
	view: DesktopAppView;
	/**
	 * The detail page or editor open within the view, so Back and Forward step
	 * through it. Only the page that opened it knows what it is; the shell
	 * compares it by identity.
	 */
	detail?: object;
};

export type DesktopAppState<SettingsSection extends string> = {
	navigation: NavigationHistory<DesktopAppLocation<SettingsSection>>;
	threads: DesktopThread[];
};

export type DesktopAppAction<SettingsSection extends string> =
	| { type: "navigate"; destination: DesktopAppLocation<SettingsSection> }
	| { type: "back" }
	| { type: "forward" }
	| { type: "replace-detail"; detail: object }
	| { type: "close-detail"; detail: object; forget?: boolean }
	| { type: "new-thread"; threadId: string; environmentId: string }
	| { type: "bind-unstarted-thread"; threadId: string; environmentId: string }
	| {
			type: "select-environment-draft";
			environmentId: string;
			threadId: string;
	  }
	| {
			type: "open-session";
			session: SessionHistoryItem;
			environmentId: string;
			initialPromptDraft?: string;
			initialAttachments?: File[];
	  }
	| { type: "consume-initial-prompt-draft"; threadId: string }
	| {
			type: "delete-session";
			deletedSessionId: string;
			environmentId?: string;
			deletedThreadId?: string;
			fallbackThreadId: string;
			fallbackEnvironmentId: string;
	  }
	| {
			type: "update-session-metadata";
			environmentId?: string;
			sessionId: string;
			metadata: SessionMetadata;
	  }
	| { type: "thread-started"; threadId: string; sessionId?: string };

function areLocationsEqual<SettingsSection extends string>(
	a: DesktopAppLocation<SettingsSection>,
	b: DesktopAppLocation<SettingsSection>,
): boolean {
	return (
		a.activeThreadId === b.activeThreadId &&
		a.settingsSection === b.settingsSection &&
		a.customizeSection === b.customizeSection &&
		a.view === b.view &&
		a.detail === b.detail
	);
}

/** Return to the list behind a detail, optionally dropping the detail from history. */
function closeDetail<SettingsSection extends string>(
	navigation: NavigationHistory<DesktopAppLocation<SettingsSection>>,
	detail: object,
	forget: boolean,
): NavigationHistory<DesktopAppLocation<SettingsSection>> {
	let next = navigation;
	if (navigation.current.detail === detail) {
		// A detail is always opened from its list, so that is one step back.
		next =
			navigation.back.length > 0
				? navigationHistoryReducer(navigation, { type: "back" })
				: navigationHistoryReducer(navigation, {
						type: "replace",
						destination: { ...navigation.current, detail: undefined },
					});
	}
	if (!forget) return next;
	const keep = (location: DesktopAppLocation<SettingsSection>) =>
		location.detail !== detail;
	return {
		back: next.back.filter(keep),
		current: next.current,
		forward: next.forward.filter(keep),
	};
}

export function createDesktopAppState<SettingsSection extends string>(
	initialThreadId: string,
	initialSettingsSection: SettingsSection,
	initialEnvironmentId: string,
): DesktopAppState<SettingsSection> {
	return {
		threads: [{ id: initialThreadId, environmentId: initialEnvironmentId }],
		navigation: createNavigationHistory({
			activeThreadId: initialThreadId,
			settingsSection: initialSettingsSection,
			customizeSection: "browse",
			view: "chat",
		}),
	};
}

export function desktopAppReducer<SettingsSection extends string>(
	state: DesktopAppState<SettingsSection>,
	action: DesktopAppAction<SettingsSection>,
): DesktopAppState<SettingsSection> {
	switch (action.type) {
		case "navigate":
			if (areLocationsEqual(state.navigation.current, action.destination)) {
				return state;
			}
			return {
				...state,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination: action.destination,
				}),
			};
		case "back":
		case "forward":
			return {
				...state,
				navigation: navigationHistoryReducer(state.navigation, action),
			};
		case "replace-detail":
			if (state.navigation.current.detail === undefined) return state;
			return {
				...state,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "replace",
					destination: { ...state.navigation.current, detail: action.detail },
				}),
			};
		case "close-detail": {
			const navigation = closeDetail(
				state.navigation,
				action.detail,
				action.forget === true,
			);
			return navigation === state.navigation ? state : { ...state, navigation };
		}
		case "new-thread":
			return {
				threads: [
					...state.threads,
					{ id: action.threadId, environmentId: action.environmentId },
				],
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination: {
						...state.navigation.current,
						detail: undefined,
						activeThreadId: action.threadId,
						view: "chat",
					},
				}),
			};
		case "bind-unstarted-thread":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.id === action.threadId &&
					!thread.hasStarted &&
					!thread.historySession
						? { ...thread, environmentId: action.environmentId }
						: thread,
				),
			};
		case "select-environment-draft": {
			const existingDraft = [...state.threads]
				.reverse()
				.find(
					(thread) =>
						thread.environmentId === action.environmentId &&
						!thread.hasStarted &&
						!thread.historySession,
				);
			const targetThreadId = existingDraft?.id ?? action.threadId;
			const threads = existingDraft
				? state.threads
				: [
						...state.threads,
						{ id: targetThreadId, environmentId: action.environmentId },
					];
			const destination = {
				...state.navigation.current,
				detail: undefined,
				activeThreadId: targetThreadId,
				view: "chat" as const,
			};
			if (
				threads === state.threads &&
				areLocationsEqual(state.navigation.current, destination)
			) {
				return state;
			}
			return {
				threads,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "navigate",
					destination,
				}),
			};
		}
		case "open-session": {
			const existingIdx = state.threads.findIndex(
				(thread) =>
					thread.environmentId === action.environmentId &&
					(thread.sessionId === action.session.sessionId ||
						thread.historySession?.sessionId === action.session.sessionId),
			);
			// A session started in this window already has a thread_* identity.
			// Keep it when opening history so its pane and draft aren't replaced.
			const threadId =
				state.threads[existingIdx]?.id ??
				`session_${sessionKey({ ...action.session, environmentId: action.environmentId })}`;
			const threads =
				existingIdx >= 0
					? state.threads.map((thread, index) =>
							index === existingIdx
								? {
										...thread,
										environmentId: action.environmentId,
										hasStarted: true,
										historySession: {
											...action.session,
											environmentId: action.environmentId,
										},
										initialPromptDraft: action.initialPromptDraft,
										initialAttachments: action.initialAttachments,
									}
								: thread,
						)
					: [
							...state.threads,
							{
								id: threadId,
								environmentId: action.environmentId,
								hasStarted: true,
								historySession: {
									...action.session,
									environmentId: action.environmentId,
								},
								initialPromptDraft: action.initialPromptDraft,
								initialAttachments: action.initialAttachments,
							},
						];
			return {
				threads,
				navigation: navigationHistoryReducer(state.navigation, {
					type:
						state.navigation.current.view === "chat" &&
						state.navigation.current.activeThreadId === threadId
							? "replace"
							: "navigate",
					destination: {
						...state.navigation.current,
						detail: undefined,
						activeThreadId: threadId,
						view: "chat",
					},
				}),
			};
		}
		case "consume-initial-prompt-draft":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.id === action.threadId &&
					(thread.initialPromptDraft !== undefined ||
						thread.initialAttachments !== undefined)
						? {
								...thread,
								initialPromptDraft: undefined,
								initialAttachments: undefined,
							}
						: thread,
				),
			};
		case "delete-session": {
			const historyThreadId = `session_${sessionKey({ sessionId: action.deletedSessionId, environmentId: action.environmentId })}`;
			const deletedThreadIds = new Set(
				state.threads
					.filter(
						(thread) =>
							thread.id === action.deletedThreadId ||
							thread.id === historyThreadId ||
							((thread.historySession?.sessionId === action.deletedSessionId ||
								thread.sessionId === action.deletedSessionId) &&
								thread.environmentId === (action.environmentId ?? "local")),
					)
					.map((thread) => thread.id),
			);
			if (action.deletedThreadId) {
				deletedThreadIds.add(action.deletedThreadId);
			}
			deletedThreadIds.add(historyThreadId);
			const hasDeletedLocation = [
				...state.navigation.back,
				state.navigation.current,
				...state.navigation.forward,
			].some((location) => deletedThreadIds.has(location.activeThreadId));
			const hasDeletedThread = state.threads.some((thread) =>
				deletedThreadIds.has(thread.id),
			);
			if (!hasDeletedThread && !hasDeletedLocation) {
				return state;
			}

			let threads = state.threads.filter(
				(thread) => !deletedThreadIds.has(thread.id),
			);
			const deletedWasActive = deletedThreadIds.has(
				state.navigation.current.activeThreadId,
			);
			let replacementThreadId = threads[0]?.id;
			if (deletedWasActive || !replacementThreadId) {
				replacementThreadId = action.fallbackThreadId;
				threads = [
					...threads,
					{
						id: replacementThreadId,
						environmentId: action.fallbackEnvironmentId,
					},
				];
			}
			const fallback: DesktopAppLocation<SettingsSection> = {
				...state.navigation.current,
				detail: undefined,
				activeThreadId: replacementThreadId,
				view: "chat",
			};
			return {
				threads,
				navigation: navigationHistoryReducer(state.navigation, {
					type: "reconcile",
					fallback,
					reconcile: (location) => {
						if (!deletedThreadIds.has(location.activeThreadId)) {
							return location;
						}
						if (location.view === "chat") {
							return null;
						}
						return {
							...location,
							activeThreadId: replacementThreadId,
						};
					},
				}),
			};
		}
		case "update-session-metadata":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.historySession?.sessionId === action.sessionId &&
					thread.environmentId === (action.environmentId ?? "local")
						? {
								...thread,
								historySession: {
									...thread.historySession,
									metadata: action.metadata,
								},
							}
						: thread,
				),
			};
		case "thread-started":
			return {
				...state,
				threads: state.threads.map((thread) =>
					thread.id === action.threadId &&
					(!thread.hasStarted ||
						(action.sessionId !== undefined &&
							thread.sessionId !== action.sessionId))
						? {
								...thread,
								hasStarted: true,
								sessionId: action.sessionId ?? thread.sessionId,
							}
						: thread,
				),
			};
	}
}
