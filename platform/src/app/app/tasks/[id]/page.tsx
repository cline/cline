import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskLiveView } from "@/components/task-live-view";
import { requireOwnedTask, requireUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";
import type {
	ApprovalRow,
	FileChangeRow,
	MessageRow,
	ProjectRow,
	TaskEventRow,
	TaskRow,
} from "@/lib/types";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const user = await requireUser();
	const { id } = await params;

	let task: TaskRow;
	try {
		task = await requireOwnedTask(id, user.id);
	} catch {
		notFound();
	}

	const client = getServiceClient();
	const [projectResult, eventsResult, messagesResult, approvalsResult, changesResult] =
		await Promise.all([
			client
				.from("a21_projects")
				.select("*")
				.eq("id", task.project_id)
				.eq("owner_id", user.id)
				.maybeSingle(),
			client
				.from("a21_task_events")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.order("id", { ascending: true })
				.limit(400),
			client
				.from("a21_messages")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.order("created_at", { ascending: true })
				.limit(300),
			client
				.from("a21_approvals")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.order("created_at", { ascending: false })
				.limit(30),
			client
				.from("a21_file_changes")
				.select("*")
				.eq("task_id", id)
				.eq("owner_id", user.id)
				.order("created_at", { ascending: false })
				.limit(100),
		]);

	if (!projectResult.data) notFound();

	const events = (eventsResult.data ?? []) as TaskEventRow[];

	return (
		<TaskLiveView
			initialTask={task}
			project={projectResult.data as ProjectRow}
			initialEvents={events}
			initialCursor={events.length > 0 ? events[events.length - 1].id : 0}
			initialMessages={(messagesResult.data ?? []) as MessageRow[]}
			initialApprovals={(approvalsResult.data ?? []) as ApprovalRow[]}
			initialChanges={(changesResult.data ?? []) as FileChangeRow[]}
		/>
	);
}
