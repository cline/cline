import { readCloudModelIdGlobally, setCloudModelIdGlobally } from "@cline/core";
import type {
	CloudModel,
	CloudRepositoryOption,
	CloudSessionSnapshot,
} from "@cline/core/cloud";
import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useRef, useState } from "react";
import open from "../../utils/open";
import {
	parseGitHubRepoFullName,
	readGitOriginUrl,
} from "../../utils/repo-status";
import {
	CloudModelPickerContent,
	CloudRepoPickerContent,
	type CloudRepoSelection,
	type CloudSetupAction,
	CloudSetupContent,
	type CloudSetupStage,
	cloudModelStatusName,
} from "../components/dialogs/cloud-dialogs";
import {
	OAuthLoginContent,
	type OAuthLoginResult,
} from "../components/dialogs/provider-picker";
import type { StatusBarCloud } from "../components/status-bar";
import type { ToastVariant } from "../components/toast";
import type { ChatEntry, CloudSessionsClient, TuiProps } from "../types";
import { hydrateSessionMessages } from "../utils/hydrate-messages";

export function describeCloudSessionStatus(
	snapshot: Pick<CloudSessionSnapshot, "status" | "busy" | "record">,
): string {
	if (snapshot.status === "provisioning") {
		const phase = snapshot.record?.metadata.provisioningPhase;
		if (phase === "cloning_repo") return "Cloning repository in Cline Cloud…";
		if (phase === "agent_starting") return "Starting agent in Cline Cloud…";
		return "Starting sandbox in Cline Cloud…";
	}
	if (snapshot.busy || snapshot.status === "running") {
		return "Working in Cline Cloud";
	}
	if (snapshot.status === "error" || snapshot.status === "failed") {
		return "Cline Cloud session failed";
	}
	if (snapshot.status === "aborted") return "Stopped in Cline Cloud";
	if (snapshot.status === "expired") return "Cline Cloud session expired";
	return "Ready in Cline Cloud";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useCloudSessions(input: {
	client?: CloudSessionsClient;
	dialog: DialogActions;
	termHeight: number;
	cwd: string;
	localBranch: string | null;
	providerId: string;
	modelId: string;
	/** A local conversation already exists, so this chat cannot move to cloud. */
	hasLocalConversation: boolean;
	/** Cloud sessions run in Act mode, so a Plan-mode UI switches over. */
	onEnterCloud: () => void;
	loadClineAccount: TuiProps["loadClineAccount"];
	onAccountChange: TuiProps["onAccountChange"];
	replaceEntries: (entries: ChatEntry[]) => void;
	showToast: (message: string, variant?: ToastVariant) => void;
	refocusTextarea: () => void;
}) {
	const {
		client,
		dialog,
		termHeight,
		providerId: localProviderId,
		modelId: localModelId,
		replaceEntries,
		showToast,
		refocusTextarea,
	} = input;
	const [target, setTarget] = useState<"local" | "cloud">("local");
	const [selection, setSelection] = useState<CloudRepoSelection>();
	const [model, setModel] = useState<CloudModel>();
	const [explicitModelId, setExplicitModelId] = useState(() =>
		readCloudModelIdGlobally(),
	);
	const [sessionId, setSessionId] = useState<string>();
	const [sessionStatus, setSessionStatus] = useState<string>();
	const sessionIdRef = useRef<string | undefined>(undefined);
	const abortRequestedRef = useRef(false);
	const pickingRef = useRef(false);
	const modelsRef = useRef<CloudModel[] | undefined>(undefined);
	const inputRef = useRef(input);
	inputRef.current = input;

	const loadModels = useCallback(async (): Promise<CloudModel[]> => {
		if (!client) throw new Error("Cline Cloud is not available");
		modelsRef.current ??= await client.listModels();
		return modelsRef.current;
	}, [client]);

	const resolveModel = useCallback(async (): Promise<CloudModel> => {
		const models = await loadModels();
		const offered = (id: string | undefined) =>
			id ? models.find((candidate) => candidate.id === id) : undefined;
		// An explicit pick wins while the catalog still offers it. Otherwise the
		// default is recomputed each time: the local Cline/ClinePass model if it's
		// offered, then ClinePass for ClinePass users, then Cline's default
		// usage-billed model.
		const next =
			offered(explicitModelId) ??
			offered(localModelId) ??
			(localProviderId === "cline-pass"
				? models.find((candidate) => candidate.catalogId === "cline-pass")
				: undefined) ??
			offered(CLINE_DEFAULT_MODEL_ID) ??
			models.find((candidate) => candidate.catalogId === "cline") ??
			models[0];
		if (!next)
			throw new Error("No cloud models are available for this account.");
		return next;
	}, [explicitModelId, loadModels, localModelId, localProviderId]);

	useEffect(() => {
		if (!client || target !== "cloud" || !selection) return;
		let cancelled = false;
		resolveModel().then(
			(next) => {
				if (!cancelled) setModel(next);
			},
			() => {},
		);
		return () => {
			cancelled = true;
		};
	}, [client, resolveModel, selection, target]);

	/** Walks the user through sign-in and GitHub access; undefined means stay local. */
	const loadRepositories = useCallback(async (): Promise<
		CloudRepositoryOption[] | undefined
	> => {
		if (!client) return undefined;
		let waiting = false;
		for (;;) {
			let stage: CloudSetupStage;
			let connectUrl: string | undefined;
			const signedIn = await inputRef.current.loadClineAccount().then(
				() => true,
				() => false,
			);
			if (!signedIn) {
				stage = "sign_in";
			} else {
				const listed = await client.listRepositories();
				if (listed.connected && listed.repositories.length > 0) {
					return listed.repositories;
				}
				stage = listed.connected ? "no_repos" : "github";
				connectUrl = listed.connectUrl;
			}
			const action = await dialog.choice<CloudSetupAction>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<CloudSetupAction>) => (
					<CloudSetupContent
						{...ctx}
						stage={stage}
						connectUrl={connectUrl}
						waiting={waiting}
					/>
				),
			});
			if (action === "sign_in") {
				const saved = await dialog.choice<OAuthLoginResult>({
					style: { maxHeight: termHeight - 2 },
					closeOnEscape: false,
					content: (ctx: ChoiceContext<OAuthLoginResult>) => (
						<OAuthLoginContent
							{...ctx}
							providerId="cline"
							providerName="Cline"
						/>
					),
				});
				if (saved === true) await inputRef.current.onAccountChange();
				continue;
			}
			if (action === "connect") {
				waiting = true;
				if (connectUrl) await open(connectUrl, { wait: false }).catch(() => {});
				continue;
			}
			if (action === "check") continue;
			return undefined;
		}
	}, [client, dialog, termHeight]);

	const pickRepository = useCallback(async () => {
		if (!client || pickingRef.current) return;
		pickingRef.current = true;
		try {
			const repositories = await loadRepositories();
			if (!repositories) {
				setTarget("local");
				return;
			}
			const originFullName = parseGitHubRepoFullName(
				await readGitOriginUrl(inputRef.current.cwd),
			);
			const picked = await dialog.choice<CloudRepoSelection>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<CloudRepoSelection>) => (
					<CloudRepoPickerContent
						{...ctx}
						repositories={repositories}
						listBranches={(id, options) => client.listBranches(id, options)}
						initial={selection}
						originFullName={originFullName}
						localBranch={inputRef.current.localBranch}
					/>
				),
			});
			if (picked) setSelection(picked);
		} catch (error) {
			showToast(`Cline Cloud: ${errorMessage(error)}`, "error");
		} finally {
			pickingRef.current = false;
			refocusTextarea();
		}
	}, [
		client,
		dialog,
		loadRepositories,
		refocusTextarea,
		selection,
		showToast,
		termHeight,
	]);

	const pickModel = useCallback(async () => {
		if (!client) return;
		try {
			const models = await loadModels();
			const picked = await dialog.choice<CloudModel>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<CloudModel>) => (
					<CloudModelPickerContent
						{...ctx}
						models={models}
						currentModelId={model?.id}
					/>
				),
			});
			if (picked) {
				setCloudModelIdGlobally(picked.id);
				setExplicitModelId(picked.id);
				setModel(picked);
			}
		} catch (error) {
			showToast(`Cline Cloud: ${errorMessage(error)}`, "error");
		} finally {
			refocusTextarea();
		}
	}, [
		client,
		dialog,
		loadModels,
		model,
		refocusTextarea,
		showToast,
		termHeight,
	]);

	const toggleTarget = useCallback(() => {
		if (sessionIdRef.current || sessionStatus) {
			showToast(
				"This chat runs in Cline Cloud. Clear it (Ctrl+L) to work locally.",
			);
			return;
		}
		if (target === "cloud") {
			setTarget("local");
			return;
		}
		if (inputRef.current.hasLocalConversation) {
			showToast("Clear the conversation (Ctrl+L) to start a cloud session.");
			return;
		}
		inputRef.current.onEnterCloud();
		setTarget("cloud");
		if (!selection) void pickRepository();
	}, [pickRepository, selection, sessionStatus, showToast, target]);

	const applySnapshot = useCallback(
		(snapshot: CloudSessionSnapshot) => {
			setSessionStatus(describeCloudSessionStatus(snapshot));
			if (snapshot.messages.length > 0) {
				replaceEntries(hydrateSessionMessages([...snapshot.messages]));
			}
		},
		[replaceEntries],
	);

	useEffect(() => {
		if (!client || !sessionId) return;
		const unsubscribe = client.subscribe((event) => {
			if (event.sessionId !== sessionId) return;
			if (event.type === "snapshot") applySnapshot(event.snapshot);
			if (event.type === "sync_failed") {
				showToast(`Cline Cloud: ${event.message}`, "error");
			}
		});
		const current = client.getSnapshot(sessionId);
		if (current) applySnapshot(current);
		return unsubscribe;
	}, [applySnapshot, client, sessionId, showToast]);

	const submit = useCallback<TuiProps["onSubmit"]>(
		async (prompt, _mode, delivery, attachments) => {
			if (!client || !selection) {
				throw new Error("Choose a repository for Cline Cloud first (Ctrl+K).");
			}
			const modelId = (await resolveModel()).id;
			let id = sessionIdRef.current;
			if (!id) {
				setSessionStatus("Starting sandbox in Cline Cloud…");
				try {
					const created = await client.create({
						repoUrl: selection.repo.url,
						branch: selection.branch,
						modelId,
						initialPrompt: prompt,
						mode: "act",
						autoApproveTools: true,
					});
					id = created.sessionId;
				} catch (error) {
					setSessionStatus(undefined);
					throw error;
				}
				sessionIdRef.current = id;
				setSessionId(id);
			}
			if (!delivery) abortRequestedRef.current = false;
			try {
				const result = await client.send(
					id,
					prompt,
					delivery,
					modelId,
					attachments?.userImages,
				);
				return {
					usage: { inputTokens: 0, outputTokens: 0 },
					iterations: 0,
					queued: result.queued,
				};
			} catch (error) {
				if (!abortRequestedRef.current) throw error;
				return {
					usage: { inputTokens: 0, outputTokens: 0 },
					iterations: 0,
					finishReason: "aborted",
				};
			}
		},
		[client, resolveModel, selection],
	);

	const abort = useCallback(() => {
		const id = sessionIdRef.current;
		if (!client || !id) return false;
		abortRequestedRef.current = true;
		void client
			.abort(id)
			.catch((error) =>
				showToast(`Cline Cloud: ${errorMessage(error)}`, "error"),
			);
		return true;
	}, [client, showToast]);

	/** Detaches this chat from its cloud session; the remote task keeps its state. */
	const reset = useCallback(() => {
		sessionIdRef.current = undefined;
		setSessionId(undefined);
		setSessionStatus(undefined);
	}, []);

	const statusBar: StatusBarCloud | undefined = client
		? {
				target,
				repoFullName: selection?.repo.fullName,
				branch: selection?.branch,
				modelName: model ? cloudModelStatusName(model) : undefined,
				sessionStatus,
			}
		: undefined;

	return {
		statusBar,
		/** Prompts go to Cline Cloud rather than the local agent. */
		active: !!client && target === "cloud",
		hasRepository: !!selection,
		/** True from the first cloud submit, including while the sandbox is created. */
		hasSession: !!sessionId || sessionStatus !== undefined,
		toggleTarget: client ? toggleTarget : undefined,
		pickRepository,
		pickModel,
		submit,
		abort,
		reset,
	};
}
