"use client";

import { AgentAurora, AgentHeroHeading } from "@cline/ui";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useWorkspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";
import { SessionContent } from "./session-content";
import { WelcomeWorkspaceControls } from "./welcome-workspace-controls";

// Prompt suggestions (including "Review changes") are temporarily disabled
// while we improve them. To re-enable, uncomment the block below plus the
// `AgentQuickActions` render in `WelcomeScreen`, restore the commented-out
// imports (`isChatWorkspacePath`, `AgentQuickAction`, `AgentQuickActions`,
// `useMemo`) and the `onStartChat`/`quickActions` props, and re-enable the
// suggestion tests in `welcome-chat.test.tsx`.
//
// import { isChatWorkspacePath } from "@cline/shared/browser";
// import { type AgentQuickAction, AgentQuickActions } from "@cline/ui";
// import { useMemo } from "react";
//
// /** Code-centric starters, shown only when the folder is a git repository. */
// const DEVELOPER_QUICK_ACTIONS: AgentQuickAction[] = [
// 	{
// 		id: "review-changes",
// 		label: "Review changes",
// 		description: "Review the current changes and call out anything risky.",
// 		value: "Review the current changes and call out anything risky.",
// 	},
// 	{
// 		id: "check-build",
// 		label: "Check for build errors",
// 		description: "Run the relevant checks and help me fix any failures.",
// 		value: "Check this project for build errors and help me fix any failures.",
// 	},
// ];
//
// /**
//  * General-purpose starters for a plain (non-git) folder — phrased around the
//  * files the agent can see, with no developer vocabulary.
//  */
// const FOLDER_QUICK_ACTIONS: AgentQuickAction[] = [
// 	{
// 		id: "summarize-folder",
// 		label: "Summarize this folder",
// 		description: "Get a plain-language overview of the files here.",
// 		value:
// 			"Look through the files in this folder and give me a plain-language summary of what's here.",
// 	},
// 	{
// 		id: "organize-files",
// 		label: "Organize these files",
// 		description: "Tidy up names and structure, with your approval.",
// 		value:
// 			"Help me organize this folder: suggest a tidy structure and clearer file names, and check with me before moving anything.",
// 	},
// 	{
// 		id: "draft-document",
// 		label: "Draft a document",
// 		description: "Start a new doc with a first draft you can edit.",
// 		value:
// 			"Help me draft a new document in this folder. Ask me a few questions about what it should cover, then write a first draft.",
// 	},
// ];
//
// /** Starters for chat with no folder selected at all. */
// const CHAT_QUICK_ACTIONS: AgentQuickAction[] = [
// 	{
// 		id: "draft-document",
// 		label: "Draft a document",
// 		description: "Start a new doc with a first draft you can edit.",
// 		value:
// 			"Help me draft a document. Ask me a few questions about what it should cover, then write a first draft.",
// 	},
// 	{
// 		id: "research-topic",
// 		label: "Research a topic",
// 		description: "Gather the key facts and sum them up.",
// 		value:
// 			"Research a topic for me: ask me what I want to learn about, then summarize the key points in plain language.",
// 	},
// 	{
// 		id: "plan-something",
// 		label: "Plan something",
// 		description: "Break a goal into clear, doable steps.",
// 		value:
// 			"Help me plan something. Ask me what I'm trying to get done, then break it into clear steps.",
// 	},
// ];
//
// /**
//  * Picks starter suggestions that match what the user actually opened: code
//  * cards only make sense inside a git repo; a plain folder gets file-oriented
//  * cards; no folder at all gets folderless general-purpose cards.
//  *
//  * `gitBranch` is `null` while branch discovery for the selected folder is
//  * still pending; no cards are suggested until the folder is classified so a
//  * git repo never flashes the plain-folder set (or vice versa).
//  */
// export function defaultQuickActionsForContext({
// 	workspaceRoot,
// 	gitBranch,
// }: {
// 	workspaceRoot: string;
// 	gitBranch: string | null;
// }): AgentQuickAction[] {
// 	const isChatWorkspace =
// 		!workspaceRoot.trim() || isChatWorkspacePath(workspaceRoot);
// 	if (isChatWorkspace) {
// 		return CHAT_QUICK_ACTIONS;
// 	}
// 	if (gitBranch === null) {
// 		return [];
// 	}
// 	if (gitBranch !== "no-git") {
// 		return DEVELOPER_QUICK_ACTIONS;
// 	}
// 	return FOLDER_QUICK_ACTIONS;
// }

export function WelcomeScreen({
	active,
	body,
	composer,
	notice,
	gitBranch,
	onListGitBranches,
	onSwitchGitBranch,
}: {
	active: boolean;
	body: ReactNode;
	composer: ReactNode;
	/** Rendered above the composer on the welcome state (e.g. setup notice). */
	notice?: ReactNode;
	/** Branch name, "no-git" for a non-repo folder, null while discovery is pending. */
	gitBranch: string | null;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
}) {
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces,
		switchWorkspace,
		pickWorkspaceDirectory,
		selectChat,
	} = useWorkspace();
	// Suggestions are disabled for now; see the note above.
	// const defaultActions = useMemo(
	// 	() => defaultQuickActionsForContext({ workspaceRoot, gitBranch }),
	// 	[workspaceRoot, gitBranch],
	// );
	// const actions = quickActions.length > 0 ? quickActions : defaultActions;

	useEffect(() => {
		if (active) void refreshWorkspaces();
	}, [active, refreshWorkspaces]);

	return (
		<div
			className={cn(
				active
					? "relative h-full min-h-0 overflow-hidden bg-background"
					: "contents",
			)}
		>
			{active ? <AgentAurora /> : null}
			<div
				className={cn(
					active
						? "relative z-10 h-full w-full overflow-x-hidden overflow-y-auto"
						: "contents",
				)}
			>
				<div
					className={cn(
						active
							? "mx-auto flex min-h-full w-full max-w-240 flex-col justify-center px-6 py-16 max-[720px]:px-4 max-[720px]:py-10"
							: "contents",
					)}
				>
					{active ? (
						<div className="cline-view-enter">
							<AgentHeroHeading />

							<div className="mt-11 flex min-w-0 items-center">
								<WelcomeWorkspaceControls
									currentBranch={gitBranch}
									onListGitBranches={onListGitBranches}
									onPickWorkspaceDirectory={pickWorkspaceDirectory}
									onRefreshWorkspaces={refreshWorkspaces}
									onSelectChat={selectChat}
									onSwitchGitBranch={onSwitchGitBranch}
									onSwitchWorkspace={switchWorkspace}
									workspaceRoot={workspaceRoot}
									workspaces={workspaces}
								/>
							</div>
						</div>
					) : null}

					<div
						className={
							active
								? "hidden"
								: "cline-view-enter h-full min-h-0 overflow-hidden"
						}
						key="conversation-body"
					>
						{body}
					</div>

					{active && notice ? notice : null}

					<div
						className={active ? "mt-4 w-full" : "z-20 shrink-0 px-6 pb-6"}
						key="persistent-composer"
					>
						{active ? composer : <SessionContent>{composer}</SessionContent>}
					</div>

					{/* Prompt suggestions are disabled for now; see the note above.
					{active ? (
						<AgentQuickActions
							actions={actions}
							className="cline-view-enter mt-11"
							onSelect={(action) => onStartChat(action.value)}
						/>
					) : null} */}
				</div>
			</div>
		</div>
	);
}
