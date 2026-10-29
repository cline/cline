import {
	useCallback,
	useEffect,
	useInsertionEffect,
	useRef,
	useState,
} from "react";
import type { PromptDraftCache } from "./use-prompt-draft";
import { toast } from "@/hooks/use-toast";
import type { InitialSideSubmission } from "@/lib/desktop-app-state";
import type { SessionHistoryItem } from "@/lib/session-history";
import {
	type CreateSideConversationResult,
	parseSideCommand,
} from "../../shared/side-conversation";

export type SideOpeningState =
	| { kind: "idle" }
	| { kind: "opening" }
	| { kind: "error"; message: string };

type OpenRequest = {
	command?: { prompt: string; question: string };
};

export function useSideConversation({
	threadId,
	sessionId,
	isLocalMain,
	existingSession,
	getCloseRevision,
	reveal,
	isSide = false,
	attachmentCount,
	pendingSubmissions,
	hydrationSucceeded,
	consumeSubmission,
	create,
	open,
	send,
	setDraft,
	drafts,
}: {
	threadId: string;
	sessionId: string | null;
	isLocalMain: boolean;
	existingSession?: SessionHistoryItem;
	getCloseRevision?: () => number;
	reveal?: () => void;
	isSide?: boolean;
	attachmentCount: number;
	pendingSubmissions?: readonly InitialSideSubmission[];
	hydrationSucceeded: boolean | null;
	consumeSubmission: (
		threadId: string,
		submission: InitialSideSubmission,
	) => void;
	create: (id: string) => Promise<CreateSideConversationResult>;
	open: (
		session: SessionHistoryItem,
		submission?: InitialSideSubmission,
		reveal?: boolean,
	) => void;
	send: (question: string) => Promise<boolean>;
	setDraft: (value: string) => void;
	drafts: PromptDraftCache;
}) {
	const [openingState, setOpeningState] = useState<SideOpeningState>({
		kind: "idle",
	});
	const retryRequest = useRef<OpenRequest>({});
	const creatingRef = useRef(false);
	const ownerVersionRef = useRef(0);
	useInsertionEffect(
		() => () => {
			ownerVersionRef.current += 1;
		},
		[],
	);
	const [uncertainSessionId, setUncertainSessionId] = useState<string | null>(
		null,
	);
	const submittedRef = useRef<InitialSideSubmission | undefined>(undefined);
	const initialSubmission = pendingSubmissions?.[0];
	useEffect(() => {
		if (
			!initialSubmission ||
			hydrationSucceeded === null ||
			submittedRef.current === initialSubmission
		)
			return;
		submittedRef.current = initialSubmission;
		consumeSubmission(threadId, initialSubmission);
		const question = initialSubmission.question;
		const restoreQuestion = () => {
			const draft = drafts.get(threadId);
			const existing = draft?.text ?? "";
			const restored = existing ? `${existing}\n\n${question}` : question;
			drafts.set(threadId, {
				text: restored,
				attachments: draft?.attachments ?? [],
			});
			setDraft(restored);
		};
		if (!hydrationSucceeded) {
			restoreQuestion();
			return;
		}
		void send(question)
			.then((taken) => {
				if (!taken) restoreQuestion();
			})
			.catch(restoreQuestion);
	}, [
		initialSubmission,
		hydrationSucceeded,
		consumeSubmission,
		threadId,
		send,
		setDraft,
		drafts,
	]);

	const openSide = useCallback(
		async (request: OpenRequest = {}): Promise<void> => {
			const command = request.command;
			if (
				!sessionId ||
				(!isLocalMain && !isSide) ||
				(command && attachmentCount > 0)
			) {
				toast({
					title: "Side conversation unavailable",
					description:
						command && attachmentCount > 0
							? "Remove attachments before opening a side conversation. You can attach them after it opens."
							: "Open an existing local main conversation to use /btw or /side. Cloud and SSH conversations are not supported.",
				});
				return;
			}
			reveal?.();
			if (creatingRef.current) {
				if (command) {
					toast({
						title: "Side chat is still opening",
						description:
							"Your question is saved in the draft. Send it again after the side chat opens.",
					});
				}
				return;
			}
			const closeRevision = getCloseRevision?.();
			const openDestination = (session: SessionHistoryItem) => {
				const submission: InitialSideSubmission | undefined = command?.question
					? { question: command.question }
					: undefined;
				if (getCloseRevision?.() !== closeRevision)
					open(session, submission, false);
				else open(session, submission);
			};
			const clearCommand = () => {
				if (command && drafts.get(threadId)?.text === command.prompt)
					setDraft("");
			};
			if (!uncertainSessionId && existingSession) {
				clearCommand();
				setOpeningState({ kind: "idle" });
				openDestination(existingSession);
				return;
			}
			retryRequest.current = request;
			creatingRef.current = true;
			setOpeningState({ kind: "opening" });
			const ownerVersion = ownerVersionRef.current;
			const newSessionId = uncertainSessionId ?? crypto.randomUUID();
			try {
				const result = await create(newSessionId);
				if (ownerVersion !== ownerVersionRef.current) return;
				clearCommand();
				setUncertainSessionId(null);
				setOpeningState({ kind: "idle" });
				openDestination({
					...result,
					origin: "local",
					status: "idle",
					startedAt: new Date().toISOString(),
				});
			} catch (error) {
				if (ownerVersion !== ownerVersionRef.current) return;
				setUncertainSessionId(newSessionId);
				setOpeningState({
					kind: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				creatingRef.current = false;
			}
		},
		[
			attachmentCount,
			create,
			isLocalMain,
			isSide,
			existingSession,
			getCloseRevision,
			reveal,
			open,
			sessionId,
			setDraft,
			uncertainSessionId,
			drafts,
			threadId,
		],
	);
	const intercept = useCallback(
		async (prompt: string): Promise<boolean> => {
			const command = parseSideCommand(prompt);
			if (!command) return false;
			setDraft(prompt);
			await openSide({
				command: { prompt, question: command.question },
			});
			return true;
		},
		[openSide, setDraft],
	);
	const retry = useCallback(() => openSide(retryRequest.current), [openSide]);
	return {
		intercept,
		openSide,
		retry,
		openingState,
	};
}
