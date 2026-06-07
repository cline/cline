"use client";

import { createContext, useContext } from "react";

type WorkspaceContextValue = {
	workspaceRoot: string;
	workspaces: string[];
	listWorkspaces: () => Promise<string[]>;
	refreshWorkspaces: () => Promise<void>;
	switchWorkspace: (workspacePath: string) => Promise<boolean>;
	pickWorkspaceDirectory: (initialPath?: string) => Promise<string | null>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
	children,
	value,
}: {
	children: React.ReactNode;
	value: WorkspaceContextValue;
}) {
	return (
		<WorkspaceContext.Provider value={value}>
			{children}
		</WorkspaceContext.Provider>
	);
}

export function useWorkspace(): WorkspaceContextValue {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) {
		throw new Error("useWorkspace must be used within a WorkspaceProvider");
	}
	return ctx;
}
