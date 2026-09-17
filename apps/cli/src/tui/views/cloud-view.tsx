import type {
	CloudBranchListResult,
	CloudSessionRecord,
} from "@cline/core/cloud";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialog, useDialogState } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CliCloudRuntime } from "../../runtime/cloud/runtime";
import {
	ChatMessageList,
	type TranscriptScrollHandle,
} from "../components/chat-message-list";
import { CloudBranchContent } from "../components/dialogs/cloud-branch-dialog";
import {
	CloudChoiceContent,
	CloudConfirmContent,
	CloudTextContent,
} from "../components/dialogs/cloud-dialogs";
import { useCloudState } from "../hooks/use-cloud-state";
import { useCloudTranscript } from "../hooks/use-cloud-transcript";
import { handleTranscriptKeybind } from "../hooks/use-root-keyboard";

import {
	CloudComposer,
	type CloudDraft,
	emptyCloudDraft,
} from "./cloud-composer";

import { CLOUD_HANDOFF_LABEL, confirmCloudHandoff } from "./cloud-handoff";

import {
	classifyCloudInput,
	dispatchCloudSessionCommand,
} from "./cloud-view-helpers";

export function CloudView(props: {
	runtime: CliCloudRuntime;
	onLocal: () => void;
	onHistory?: () => void;
	onExit: () => void;
	onAccount: () => void;
	onTheme: () => void;
	initialBranch?: string | null;
}) {
	const { runtime } = props;
	const { height: terminalHeight } = useTerminalDimensions();
	const state = useCloudState(runtime) ?? runtime.getSnapshot();
	const dialog = useDialog();
	const isDialogOpen = useDialogState(
		(value: { isOpen: boolean }) => value.isOpen,
	);
	const [composing, setComposing] = useState(false);
	const [draft, setDraft] = useState<CloudDraft>(emptyCloudDraft);
	const [selectedTask, setSelectedTask] = useState(-1);
	const [tasks, setTasks] = useState<CloudSessionRecord[]>([]);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [input, setInput] = useState("");
	const [message, setMessage] = useState<string>();
	const [listError, setListError] = useState<string>();
	const actionInFlight = useRef(false);
	const requestGeneration = useRef(0);
	const transcriptRef = useRef<TranscriptScrollHandle | null>(null);
	const scopeKey = JSON.stringify(state.scope);
	const previousScope = useRef(scopeKey);
	const previousEnabled = useRef(state.eligibility.enabled);
	useEffect(() => {
		if (
			previousScope.current !== scopeKey ||
			(previousEnabled.current && !state.eligibility.enabled)
		)
			dialog.closeAll();
		previousScope.current = scopeKey;
		previousEnabled.current = state.eligibility.enabled;
	}, [scopeKey, state.eligibility.enabled, dialog]);
	const session = state.session;
	const entries = useCloudTranscript(runtime, state.target);
	const active = Boolean(session);
	const canHandoff = state.eligibility.enabled && runtime.hasHandoffSource();
	const firstPickerIndex = canHandoff ? -2 : -1;
	useEffect(() => {
		setSelectedTask(canHandoff ? -2 : -1);
	}, [canHandoff]);
	const canSend =
		state.eligibility.enabled &&
		session?.connectionState === "connected" &&
		session.transcriptKnown &&
		!["expired", "failed"].includes(session.record?.status ?? session.status);

	const run = useCallback(async (action: () => Promise<void>) => {
		if (actionInFlight.current) return;
		actionInFlight.current = true;
		setBusy(true);
		setMessage(undefined);
		try {
			await action();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			actionInFlight.current = false;
			setBusy(false);
		}
	}, []);
	const refresh = useCallback(async () => {
		if (!runtime.getSnapshot().eligibility.enabled) return;
		const generation = ++requestGeneration.current;
		setLoading(true);
		setListError(undefined);
		try {
			const next = await runtime.list();
			if (generation === requestGeneration.current) setTasks(next);
		} catch (error) {
			if (generation === requestGeneration.current)
				setListError(error instanceof Error ? error.message : String(error));
		} finally {
			if (generation === requestGeneration.current) setLoading(false);
		}
	}, [runtime]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A changed scope or admission must clear private UI and invalidate discovery.
	useEffect(() => {
		setComposing(false);
		setDraft(emptyCloudDraft());
		setTasks([]);
		setSelectedTask(runtime.hasHandoffSource() ? -2 : -1);
		setInput("");
		setMessage(undefined);
		setListError(undefined);
		void refresh();
		return () => {
			++requestGeneration.current;
		};
	}, [scopeKey, state.eligibility.enabled, refresh]);
	useEffect(
		() => () => {
			runtime.detach();
		},
		[runtime],
	);

	const confirm = (title: string, detail: string) =>
		dialog.choice<boolean>({
			content: (ctx: ChoiceContext<boolean>) => (
				<CloudConfirmContent {...ctx} title={title} detail={detail} />
			),
		});
	const choose = (
		title: string,
		items: Array<{ id: string; label: string }>,
		initial?: string,
		detail?: string,
	) =>
		dialog.choice<string>({
			size: "large",
			content: (ctx: ChoiceContext<string>) => (
				<CloudChoiceContent
					{...ctx}
					title={title}
					items={items}
					initial={initial}
					detail={detail}
				/>
			),
		});
	const chooseBranch = (
		repositoryId: number,
		initial: CloudBranchListResult,
		selected: string,
	) =>
		dialog.choice<string>({
			size: "large",
			content: (ctx: ChoiceContext<string>) => (
				<CloudBranchContent
					{...ctx}
					initial={initial}
					selectedBranch={selected}
					load={(options) => runtime.listBranches(repositoryId, options)}
				/>
			),
		});
	const askText = (title: string, detail?: string, initial?: string) =>
		dialog.choice<string>({
			content: (ctx: ChoiceContext<string>) => (
				<CloudTextContent
					{...ctx}
					title={title}
					detail={detail}
					initial={initial}
				/>
			),
		});

	const continueConversation = async () => {
		const generation = requestGeneration.current;
		await confirmCloudHandoff({
			runtime,
			isCurrent: () =>
				generation === requestGeneration.current &&
				runtime.getSnapshot().eligibility.enabled,
			confirm,
		});
	};

	const create = async () => {
		runtime.detach();
		setInput("");
		setComposing(true);
	};
	const sessionId = session?.sessionId;
	useEffect(() => {
		if (sessionId) {
			setComposing(false);
			setDraft((previous) => ({ ...previous, prompt: "" }));
		}
	}, [sessionId]);

	const dispatch = async (text: string, delivery?: "queue" | "steer") => {
		const { command, argument } = classifyCloudInput(text);
		if (!command) {
			if (!canSend)
				throw new Error(
					"Open a connected cloud task before sending. This text has not been submitted.",
				);
			const target = runtime.getSnapshot().target;
			void runtime.send(text, delivery).catch((error) => {
				if (runtime.getSnapshot().target === target) setMessage(String(error));
			});
			return;
		}
		if (command === "quit" || command === "exit") {
			runtime.detach();
			props.onExit();
			return;
		}
		if (command === "local" || command === "history") {
			runtime.detach();
			props.onLocal();
			if (command === "history") props.onHistory?.();
			return;
		}
		if (command === "clear" || command === "cloud") {
			runtime.detach();
			await refresh();
			return;
		}
		if (command === "account") {
			runtime.detach();
			props.onAccount();
			return;
		}
		if (command === "theme") {
			props.onTheme();
			return;
		}
		if (command === "refresh") {
			await runtime.refreshIdentity();
			await refresh();
			return;
		}
		if (command === "new") {
			if (active) runtime.detach();
			await create();
			return;
		}
		if (command === "open") {
			const task = tasks[Number(argument) - 1];
			if (!task)
				throw new Error("Use /open followed by the task number in the picker.");
			await runtime.attach(task.id);
			return;
		}
		if (await dispatchCloudSessionCommand(runtime, state, command, argument))
			return;
		if (command === "edit") {
			const item = session?.promptsInQueue[Number(argument) - 1];
			if (!item) throw new Error("Use a queued message number.");
			const target = state.target;
			const changed = await askText(
				"Edit queued message",
				"Literal cloud text",
				item.prompt,
			);
			if (runtime.getSnapshot().target !== target)
				throw new Error("Cloud session changed. Edit the message again.");
			if (changed?.trim()) await runtime.updatePendingPrompt(item.id, changed);
			return;
		}
		if (["recover", "resume", "cancel"].includes(command)) {
			const row = state.pendingCreations[Number(argument) - 1];
			if (!row) throw new Error("Use the recovery record number.");
			if (command === "recover") {
				await runtime.recover(row.requestId);
				return;
			}
			if (command === "cancel") {
				if (
					await confirm(
						"Cancel creation and delete sandbox?",
						"Only the sandbox associated with this creation will be deleted. Unknown outcomes stay recoverable.",
					)
				)
					await runtime.cancelCreation(row.requestId);
				return;
			}
			const unknown = row.intent === "delivery_unknown";
			if (
				await confirm(
					unknown
						? "Resend draft despite duplicate risk?"
						: "Resume saved draft?",
					unknown
						? "Delivery is unconfirmed. The previous prompt may already be running. Resending can duplicate work."
						: "This explicitly submits the locally saved draft to the recovered cloud task.",
				)
			)
				void runtime
					.resumeDraft(row.requestId, unknown)
					.catch((error) => setMessage(String(error)));
			return;
		}
		if (command === "help") {
			setMessage(
				"/new /open N /refresh /cloud /local /account /theme /stop /approve N /reject N /edit N /remove N /steer N /recover N /resume N /cancel N /quit. Other local commands are unavailable in cloud.",
			);
			return;
		}
		throw new Error(
			`/${command} is unavailable in cloud. Use /help for supported actions.`,
		);
	};
	const submit = (delivery?: "queue" | "steer") => {
		if (!input.trim()) return;
		const text = input;
		// Cleanup and detach remain usable while a create waits on provisioning.
		if (
			/^\/(?:cancel|quit|exit|local|cloud|clear|approve|reject|stop|abort|edit|remove|steer)(?:\s|$)/.test(
				text.trim(),
			)
		) {
			void dispatch(text)
				.then(() => setInput(""))
				.catch((error) => setMessage(String(error)));
			return;
		}
		if (busy) return;
		void run(async () => {
			await dispatch(text, delivery);
			setInput("");
		});
	};
	const openActions = async () => {
		const actions = [
			...(!session && canHandoff
				? [{ id: "handoff", label: CLOUD_HANDOFF_LABEL }]
				: []),
			...(state.eligibility.enabled
				? [{ id: "new", label: "New cloud task" }]
				: []),
			...(session?.busy ? [{ id: "stop", label: "Stop task" }] : []),
			...(session?.approvals.flatMap((approval, index) => [
				{ id: `approve ${index + 1}`, label: `Approve: ${approval.toolName}` },
				{ id: `reject ${index + 1}`, label: `Reject: ${approval.toolName}` },
			]) ?? []),
			...(session?.promptsInQueue.flatMap((item, index) => [
				{ id: `edit ${index + 1}`, label: `Edit queued: ${item.prompt}` },
				{ id: `remove ${index + 1}`, label: `Remove queued: ${item.prompt}` },
				{ id: `steer ${index + 1}`, label: `Steer with: ${item.prompt}` },
			]) ?? []),
			...state.pendingCreations.flatMap((row, index) => [
				{ id: `recover ${index + 1}`, label: `Recover task: ${row.repoUrl}` },
				{ id: `resume ${index + 1}`, label: `Resume draft: ${row.repoUrl}` },
				{ id: `cancel ${index + 1}`, label: `Cancel creation: ${row.repoUrl}` },
			]),
			{ id: "cloud", label: "Cloud tasks" },
			{ id: "refresh", label: "Refresh cloud tasks" },
			{ id: "local", label: "Switch to local" },
			{ id: "account", label: "Account" },
			{ id: "quit", label: "Quit (leave remote tasks running)" },
		];
		const action = await choose("Cloud actions", actions);
		if (action === "handoff") await continueConversation();
		else if (action) await dispatch(`/${action}`);
	};
	useKeyboard((key) => {
		if (isDialogOpen || composing) return;
		if (key.ctrl && ["n", "r", "p"].includes(key.name)) {
			key.preventDefault();
			if (key.name === "n" && state.eligibility.enabled) void run(create);
			if (key.name === "r") void run(() => dispatch("/refresh"));
			if (key.name === "p") void run(openActions);

			return;
		}
		if (key.ctrl && key.name === "c") {
			key.preventDefault();
			if (session?.busy && !state.stopping)
				void runtime.stop().catch((error) => setMessage(String(error)));
			else {
				runtime.detach();
				props.onExit();
			}
			return;
		}
		if (key.name === "escape") {
			key.preventDefault();
			if (session?.busy)
				void runtime.stop().catch((error) => setMessage(String(error)));
			else {
				runtime.detach();
				props.onLocal();
			}
			return;
		}
		if (!session && !input && state.eligibility.enabled && !loading && !busy) {
			if (key.name === "up" || key.name === "down") {
				key.preventDefault();
				setSelectedTask((value) =>
					key.name === "up"
						? Math.max(firstPickerIndex, value - 1)
						: Math.min(tasks.length - 1, value + 1),
				);
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				key.preventDefault();
				void run(async () => {
					if (selectedTask === -2 && canHandoff) await continueConversation();
					else if (selectedTask < 0) await create();
					else if (tasks[selectedTask])
						await runtime.attach(tasks[selectedTask].id);
				});
				return;
			}
		}
		if (handleTranscriptKeybind(key, transcriptRef.current)) return;
		if (key.ctrl && key.name === "s") {
			key.preventDefault();
			submit("steer");
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			key.preventDefault();
			submit(session?.busy ? "queue" : undefined);
		}
	});

	return (
		<box flexDirection="column" width="100%" height="100%" paddingX={1}>
			<text flexShrink={0} fg="cyan">
				Cloud ·{" "}
				{state.accountLabel ?? state.scope?.accountId ?? "Sign in to Cline"} ·{" "}
				{state.organizationLabel ?? "Personal"}
			</text>
			{!composing && (
				<text flexShrink={0} fg="gray">
					Ctrl+N new task · Ctrl+P actions · Ctrl+R refresh
				</text>
			)}
			{session && (
				<text flexShrink={0}>
					{session.record?.repoContext.repoUrl ?? "Repository unknown"} ·{" "}
					{session.record?.repoContext.branch ?? "Branch unknown"} ·{" "}
					{String(
						session.config.modelId ??
							session.record?.metadata.modelId ??
							"Model unknown",
					)}
				</text>
			)}
			{session && (
				<text flexShrink={0} fg="gray">
					{session.connectionState} ·{" "}
					{session.record?.metadata.provisioningPhase ?? session.status} ·{" "}
					{session.busy ? "Running" : "Idle"}
					{state.stopping ? " · Stop pending" : ""}
				</text>
			)}
			{session && (
				<text flexShrink={0} fg="gray">
					Tools:{" "}
					{typeof session.config.autoApproveTools === "boolean"
						? session.config.autoApproveTools
							? "Auto-approve"
							: "Manual approval"
						: "Server policy"}{" "}
					· Usage:{" "}
					{typeof session.usage?.inputTokens === "number"
						? session.usage.inputTokens
						: "?"}{" "}
					in /{" "}
					{typeof session.usage?.outputTokens === "number"
						? session.usage.outputTokens
						: "?"}{" "}
					out · Cost:{" "}
					{typeof session.usage?.totalCost === "number"
						? `$${session.usage.totalCost.toFixed(4)}`
						: "unknown"}
				</text>
			)}
			{!state.eligibility.enabled && (
				<box flexDirection="column" flexGrow={1}>
					<text flexShrink={0}>
						{state.eligibility.checking
							? "Checking cloud availability…"
							: "Cloud agents are unavailable for this account."}
					</text>
					<text flexShrink={0}>
						Existing remote tasks continue: {state.dashboardUrl}
					</text>
					<text flexShrink={0}>
						/refresh to check again · /account to sign in or switch · /local to
						return
					</text>
				</box>
			)}
			{state.eligibility.enabled && !session && !composing && (
				<scrollbox flexGrow={1}>
					<box flexDirection="column" gap={1}>
						<text flexShrink={0}>Cloud tasks · ↑↓ select · Enter open</text>
						{canHandoff && (
							// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI mouse action has arrow/Enter and Cloud actions keyboard equivalents.
							<text
								flexShrink={0}
								fg={selectedTask === -2 ? "cyan" : undefined}
								onMouseDown={() => {
									void run(continueConversation);
								}}
							>
								{selectedTask === -2 ? "> " : "  "}
								{CLOUD_HANDOFF_LABEL}
							</text>
						)}
						<text flexShrink={0} fg={selectedTask === -1 ? "cyan" : undefined}>
							{selectedTask === -1 ? "> " : "  "}New cloud task (Enter)
						</text>
						{loading ? (
							<text flexShrink={0}>Loading tasks…</text>
						) : listError ? (
							<text flexShrink={0} fg="red">
								Could not load tasks: {listError} · /refresh to retry
							</text>
						) : tasks.length === 0 ? (
							<text flexShrink={0}>No cloud tasks in this account.</text>
						) : (
							tasks.map((task, index) => (
								// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI mouse action also has arrow/Enter and /open keyboard equivalents.
								<text
									flexShrink={0}
									key={task.id}
									fg={selectedTask === index ? "cyan" : undefined}
									onMouseDown={() => {
										void run(() => runtime.attach(task.id));
									}}
								>
									{selectedTask === index ? "> " : "  "}
									{index + 1}. {task.title ?? task.id} · {task.status} ·{" "}
									{task.repoContext.branch ?? ""}
								</text>
							))
						)}
					</box>
				</scrollbox>
			)}
			{state.eligibility.enabled && composing && !session && (
				<CloudComposer
					key={scopeKey}
					runtime={runtime}
					draft={draft}
					onChange={setDraft}
					choose={choose}
					chooseBranch={chooseBranch}
					dialogOpen={isDialogOpen}
					initialBranch={props.initialBranch}
					onClose={() => setComposing(false)}
				/>
			)}
			{state.eligibility.enabled && session && (
				<ChatMessageList ref={transcriptRef} entries={entries} uiMode="act" />
			)}
			{state.handoffProgress && (
				<text flexShrink={0} fg="yellow">
					Cloud handoff · {state.handoffProgress.message}
				</text>
			)}
			{state.creating && !state.handoffProgress && (
				<text flexShrink={0} fg="yellow">
					Creating/provisioning task. Leaving detaches; it does not cancel.
					/cancel N deletes its sandbox.
				</text>
			)}
			{(state.pendingCreations.length > 0 ||
				(session?.approvals.length ?? 0) > 0 ||
				(session?.promptsInQueue.length ?? 0) > 0) && (
				<scrollbox maxHeight={Math.max(4, Math.floor(terminalHeight * 0.35))}>
					<box flexDirection="column" gap={1}>
						{state.pendingCreations.length > 0 && (
							<box flexDirection="column">
								<text flexShrink={0} fg="yellow">
									Recovery drafts (kept locally for 7 days; expiry does not
									delete remote tasks)
								</text>
								{state.pendingCreations.map((row, index) => (
									<text flexShrink={0} key={row.requestId}>
										{index + 1}. {row.repoUrl} · {row.intent} · /recover{" "}
										{index + 1} · /resume {index + 1} · /cancel {index + 1}
									</text>
								))}
							</box>
						)}
						{session?.approvals.map((approval, index) => (
							<box key={approval.approvalId} flexDirection="column">
								<text flexShrink={0} fg="yellow">
									Approval {index + 1}: {approval.toolName} ·{" "}
									{approval.approvalId}
								</text>
								<text flexShrink={0}>{JSON.stringify(approval.input)}</text>
								<box flexDirection="row" gap={2}>
									{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI mouse action also has /approve keyboard equivalent. */}
									<text
										flexShrink={0}
										onMouseDown={() => {
											void dispatchCloudSessionCommand(
												runtime,
												state,
												"approve",
												String(index + 1),
											).catch((error) => setMessage(String(error)));
										}}
									>
										Approve (/approve {index + 1})
									</text>
									{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI mouse action also has /reject keyboard equivalent. */}
									<text
										flexShrink={0}
										onMouseDown={() => {
											void dispatchCloudSessionCommand(
												runtime,
												state,
												"reject",
												String(index + 1),
											).catch((error) => setMessage(String(error)));
										}}
									>
										Reject (/reject {index + 1})
									</text>
								</box>
								<text flexShrink={0} fg="gray">
									Closing leaves this approval pending.
								</text>
							</box>
						))}
						{session?.promptsInQueue.map((item, index) => (
							<text flexShrink={0} key={item.id}>
								Queue {index + 1}: {item.prompt} · /edit {index + 1} /remove{" "}
								{index + 1} /steer {index + 1}
							</text>
						))}
					</box>
				</scrollbox>
			)}
			{(message || state.error) && (
				<text flexShrink={0} fg="yellow">
					{message ?? state.error}
				</text>
			)}
			{!composing && (
				<box border borderColor="cyan" paddingX={1} height={3} flexShrink={0}>
					<input
						value={input}
						onInput={setInput}
						focused={!isDialogOpen}
						placeholder={
							busy
								? "Working…"
								: canSend
									? "Cloud message (literal text) or /help"
									: "↑↓ browse tasks · Ctrl+N new task · Ctrl+P actions"
						}
						flexGrow={1}
					/>
				</box>
			)}
			{!composing && (
				<text flexShrink={0} fg="gray">
					Enter send/queue · Ctrl+S steer · Ctrl+C stop · Ctrl+P task actions
				</text>
			)}
		</box>
	);
}
