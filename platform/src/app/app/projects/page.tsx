import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProjectsView } from "@/components/projects-view";
import { requireUser } from "@/lib/auth";
import { getOrCreateProfile } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, WorkspaceRow } from "@/lib/types";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({
	searchParams,
}: {
	searchParams: Promise<{ new?: string }>;
}) {
	const user = await requireUser();
	const { new: openNew } = await searchParams;
	const [profile, projectsResult] = await Promise.all([
		getOrCreateProfile(user),
		getServiceClient()
			.from("a21_projects")
			.select("*")
			.eq("owner_id", user.id)
			.order("updated_at", { ascending: false }),
	]);

	const projects = (projectsResult.data ?? []) as ProjectRow[];
	let workspaces: WorkspaceRow[] = [];
	if (projects.length > 0) {
		const { data } = await getServiceClient()
			.from("a21_workspaces")
			.select("*")
			.eq("owner_id", user.id)
			.in(
				"project_id",
				projects.map((project) => project.id),
			);
		workspaces = (data ?? []) as WorkspaceRow[];
	}

	return (
		<div className="space-y-6">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="eyebrow">Projects</p>
					<h1 className="display mt-2 text-3xl font-semibold">Your workspaces</h1>
					<p className="mt-2 max-w-xl text-sm text-mist-500">
						Every project is backed by its own isolated sandbox. Files and dependencies persist
						between tasks until you release the workspace.
					</p>
				</div>
				<div className="flex gap-2">
					<Link href="/app/tasks" className="btn btn-secondary">
						Task history
					</Link>
					<Link href="/app/projects?new=1" className="btn btn-primary">
						<Plus className="size-4" /> New project
					</Link>
				</div>
			</header>

			<ProjectsView
				initialProjects={projects}
				initialWorkspaces={workspaces}
				openNew={openNew === "1"}
				plan={profile.plan}
			/>
		</div>
	);
}
