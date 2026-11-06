import type { Metadata } from "next";
import { TasksView } from "@/components/tasks-view";
import { requireUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, TaskRow } from "@/lib/types";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

export default async function TasksPage({
	searchParams,
}: {
	searchParams: Promise<{ projectId?: string; status?: string }>;
}) {
	const user = await requireUser();
	const { projectId, status } = await searchParams;
	const client = getServiceClient();

	let query = client
		.from("a21_tasks")
		.select("*")
		.eq("owner_id", user.id)
		.order("created_at", { ascending: false })
		.limit(100);
	if (projectId) query = query.eq("project_id", projectId);
	if (status) query = query.eq("status", status);

	const [tasksResult, projectsResult] = await Promise.all([
		query,
		client.from("a21_projects").select("id, name, language").eq("owner_id", user.id).order("name"),
	]);

	return (
		<TasksView
			initialTasks={(tasksResult.data ?? []) as TaskRow[]}
			projects={(projectsResult.data ?? []) as Array<Pick<ProjectRow, "id" | "name" | "language">>}
			initialProjectId={projectId ?? ""}
			initialStatus={status ?? ""}
		/>
	);
}
