import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile, getOrCreateSettings, hasPersonalOpenRouterKey } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";
import { updateSettingsSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const user = await requireUser();
		const [profile, settings, personalKey] = await Promise.all([
			getOrCreateProfile(user),
			getOrCreateSettings(user.id),
			hasPersonalOpenRouterKey(user.id),
		]);

		const { data: keyRow } = await getServiceClient()
			.from("a21_provider_keys")
			.select("last4, updated_at")
			.eq("owner_id", user.id)
			.eq("provider", "openrouter")
			.maybeSingle();

		return jsonOk({
			profile,
			settings,
			plan: profile.plan,
			limits: limitsForPlan(profile.plan),
			key: {
				personal: personalKey,
				last4: keyRow?.last4 ?? null,
				updatedAt: keyRow?.updated_at ?? null,
				serverConfigured: Boolean(process.env.OPENROUTER_API_KEY),
				sandboxConfigured: Boolean(process.env.DAYTONA_API_KEY),
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}

export async function PATCH(request: Request) {
	try {
		const user = await requireUser();
		const body = await readJson(request, updateSettingsSchema);
		const client = getServiceClient();

		const patch: Record<string, unknown> = {};
		if (body.defaultModel !== undefined) patch.default_model = body.defaultModel;
		if (body.theme !== undefined) patch.theme = body.theme;
		if (body.monthlyTokenLimit !== undefined) patch.monthly_token_limit = body.monthlyTokenLimit;
		if (body.monthlyTaskLimit !== undefined) patch.monthly_task_limit = body.monthlyTaskLimit;
		if (body.maxConcurrentTasks !== undefined) patch.max_concurrent_tasks = body.maxConcurrentTasks;
		if (body.terminalTimeoutSeconds !== undefined) {
			patch.terminal_timeout_seconds = body.terminalTimeoutSeconds;
		}

		if (Object.keys(patch).length > 0) {
			const { error } = await client.from("a21_settings").update(patch).eq("owner_id", user.id);
			if (error) throw new ApiError(500, "settings_update_failed", "Could not save settings.");
		}

		if (body.defaultModel !== undefined || body.theme !== undefined) {
			await client
				.from("a21_profiles")
				.update({
					...(body.defaultModel !== undefined ? { default_model: body.defaultModel } : {}),
					...(body.theme !== undefined ? { theme: body.theme } : {}),
				})
				.eq("id", user.id);
		}

		const settings = await getOrCreateSettings(user.id);
		const profile = await getOrCreateProfile(user);
		return jsonOk({ settings, profile });
	} catch (error) {
		return handleApiError(error);
	}
}
