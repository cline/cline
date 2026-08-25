"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useWorkspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";
import { SessionContent } from "./session-content";
import { WelcomeHero } from "./welcome-hero";
import { WelcomeWorkspaceControls } from "./welcome-workspace-controls";

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
							<h1 className="sr-only">What would you like to build?</h1>
							<WelcomeHero />

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
				</div>
			</div>
		</div>
	);
}
