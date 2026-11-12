import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import type { McpServer } from "@/lib/extension-inventory";
import {
	buildServerInput,
	createServerFormState,
	type McpServerFormState,
} from "./mcp-server-form-state";
import { useMcpServers } from "./use-mcp-servers";

type EditorAction = "save" | "toggle" | "delete" | "authorize";
const SAVED_CONFIRMATION_MS = 3_000;

function isSameForm(left: McpServerFormState, right: McpServerFormState) {
	return JSON.stringify(left) === JSON.stringify(right);
}
export type McpEditorBack = (options?: { uninstalled: boolean }) => void;

/** Keep the editable draft separate from live connection and enabled state. */
export function useMcpServerEditor({
	server,
	onBack,
}: {
	server?: McpServer;
	onBack: McpEditorBack;
}) {
	const [form, setFormState] = useState(() => createServerFormState(server));
	const formRef = useRef(form);
	// The draft as last saved or opened; anything else is an unsaved change.
	const savedFormRef = useRef(form);
	const [isSaved, setIsSaved] = useState(false);
	const savedTimeout = useRef<number | undefined>(undefined);
	const setForm: Dispatch<SetStateAction<McpServerFormState>> = useCallback(
		(update) => {
			const next =
				typeof update === "function" ? update(formRef.current) : update;
			if (next === formRef.current) return;
			window.clearTimeout(savedTimeout.current);
			setIsSaved(false);
			formRef.current = next;
			setFormState(next);
		},
		[],
	);
	const [persistedServer, setPersistedServer] = useState(server);
	const persistedServerRef = useRef(server);
	const serverName = useRef(server?.name);
	const mounted = useIsMounted();
	const closed = useRef(false);
	const onBackRef = useRef(onBack);
	onBackRef.current = onBack;
	const pendingRef = useRef<EditorAction | null>(null);
	const [pendingAction, setPendingAction] = useState<EditorAction | null>(null);
	const cancellingRef = useRef(false);
	const [isCancelling, setIsCancelling] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => () => window.clearTimeout(savedTimeout.current), []);
	const dismiss = useCallback(
		(options?: { uninstalled: boolean }) => {
			if (!mounted.current || closed.current) return;
			closed.current = true;
			onBackRef.current(options);
		},
		[mounted],
	);
	const state = useMcpServers({
		initialServers: server ? [server] : undefined,
		onResponse: (response) => {
			if (
				!mounted.current ||
				closed.current ||
				serverName.current === undefined
			)
				return;
			const next = response.servers.find(
				(item) => item.name === serverName.current,
			);
			persistedServerRef.current = next;
			setPersistedServer(next);
			if (!next) {
				dismiss({ uninstalled: true });
				return;
			}
			// A refresh, toggle, or OAuth response must not reset the draft.
			// Enabled is saved immediately, so it is never an unsaved change.
			savedFormRef.current = {
				...savedFormRef.current,
				disabled: next.disabled,
			};
			if (formRef.current.disabled !== next.disabled)
				setForm((current) => ({ ...current, disabled: next.disabled }));
		},
		onServerSaved: (name, previousName) => {
			// Follow this editor's server through its first save and any rename.
			if (previousName === undefined || serverName.current === previousName)
				serverName.current = name;
		},
	});

	const begin = (action: EditorAction) => {
		if (
			!mounted.current ||
			closed.current ||
			pendingRef.current ||
			cancellingRef.current
		)
			return false;
		pendingRef.current = action;
		setPendingAction(action);
		setError(null);
		return true;
	};
	const finish = () => {
		pendingRef.current = null;
		if (mounted.current && !closed.current) setPendingAction(null);
	};
	const save = async () => {
		if (!begin("save")) return;
		try {
			const input = buildServerInput({
				...formRef.current,
				previousName: serverName.current,
				disabled:
					persistedServerRef.current?.disabled ?? formRef.current.disabled,
			});
			const submitted = formRef.current;
			await state.upsertServer(input);
			if (!mounted.current || closed.current) return;
			// Stay on the page: the saved server is now what this editor edits.
			savedFormRef.current = {
				...submitted,
				disabled: formRef.current.disabled,
			};
			setIsSaved(true);
			savedTimeout.current = window.setTimeout(
				() => setIsSaved(false),
				SAVED_CONFIRMATION_MS,
			);
		} catch (cause) {
			if (mounted.current && !closed.current)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			finish();
		}
	};
	const changeEnabled = async (enabled: boolean) => {
		if (!persistedServerRef.current) {
			if (!pendingRef.current && !closed.current)
				setForm((current) => ({ ...current, disabled: !enabled }));
			return;
		}
		if (!begin("toggle")) return;
		try {
			await state.toggleServer(persistedServerRef.current, !enabled);
		} finally {
			finish();
		}
	};
	const deleteServer = async () => {
		const saved = persistedServerRef.current;
		if (!saved || !begin("delete")) return;
		try {
			// The inventory response closes the editor only after a successful delete.
			await state.deleteServer(saved.name);
		} finally {
			finish();
		}
	};
	const authorizeOAuth = async () => {
		const saved = persistedServerRef.current;
		if (!saved || !begin("authorize")) return;
		try {
			await state.authorizeOAuth(saved.name);
		} finally {
			finish();
		}
	};
	/** Whether leaving now would lose edits; reads live state, not the last render. */
	const hasUnsavedChangesNow = useCallback(
		() => !closed.current && !isSameForm(formRef.current, savedFormRef.current),
		[],
	);
	const cancelOAuth = async () => {
		const saved = persistedServerRef.current;
		if (!saved || !mounted.current || closed.current || cancellingRef.current)
			return;
		cancellingRef.current = true;
		setIsCancelling(true);
		try {
			await state.cancelOAuth(saved.name);
		} finally {
			cancellingRef.current = false;
			if (mounted.current && !closed.current) setIsCancelling(false);
		}
	};

	return {
		form,
		setForm,
		persistedServer,
		state,
		error,
		isBusy: pendingAction !== null || isCancelling,
		isSaving: pendingAction === "save",
		isSaved,
		hasUnsavedChangesNow,
		isAuthorizing: pendingAction === "authorize",
		isCancelling,
		save,
		changeEnabled,
		deleteServer,
		authorizeOAuth,
		cancelOAuth,
		close: () => {
			if (!pendingRef.current && !cancellingRef.current) dismiss();
		},
	};
}
