import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceView } from "@/components/workspace-view";
import { requireOwnedProject, requireUser } from "@/lib/auth";
import { getWorkspaceRow } from "@/lib/sandbox/workspace-service";
import { getServiceClient } from "@/lib/supabase/service";
import type { FileChangeRow, ProjectRow, TaskRow } from "@/lib/types";

export const metadata: Metadata = { title: "Workspace" };
export const dynamic = "force-dynamic";

export default async function ProjectWorkspacePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const user = await requireUser();
	const { id } = await params;

	let project: ProjectRow;
	try {
		project = await requireOwnedProject(id, user.id);
	} catch {
		notFound();
	}

	const [workspace, tasksResult, changesResult] = await Promise.all([
		getWorkspaceRow(id, user.id),
		getServiceClient()
			.from("a21_tasks")
			.select("*")
			.eq("project_id", id)
			.eq("owner_id", user.id)
			.order("created_at", { ascending: false })
			.limit(8),
		getServiceClient()
			.from("a21_file_changes")
			.select("*")
			.eq("project_id", id)
			.eq("owner_id", user.id)
			.order("created_at", { ascending: false })
			.limit(40),
	]);

	return (
		<WorkspaceView
			project={project}
			initialWorkspace={workspace}
			initialTasks={(tasksResult.data ?? []) as TaskRow[]}
			initialChanges={(changesResult.data ?? []) as FileChangeRow[]}
		/>
	);
}
