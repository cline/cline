import { handleApiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";
import { countActiveTasks, getMonthlyUsage, startOfMonth } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const user = await requireUser();
		const profile = await getOrCreateProfile(user);
		const client = getServiceClient();

		const [usage, tasksResult, active] = await Promise.all([
			getMonthlyUsage(user.id),
			client
				.from("a21_tasks")
				.select("id", { count: "exact", head: true })
				.eq("owner_id", user.id)
				.gte("created_at", startOfMonth().toISOString()),
			countActiveTasks(user.id),
		]);

		return jsonOk({
			plan: profile.plan,
			limits: limitsForPlan(profile.plan),
			usage,
			tasksThisMonth: tasksResult.count ?? 0,
			activeTasks: active,
		});
	} catch (error) {
		return handleApiError(error);
	}
}
