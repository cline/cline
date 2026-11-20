import { ApiError, handleApiError, jsonOk, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getOrCreateProfile } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";
import { updateProfileSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
	try {
		const user = await requireUser();
		const body = await readJson(request, updateProfileSchema);

		const patch: Record<string, unknown> = {};
		if (body.displayName !== undefined) patch.display_name = body.displayName;
		if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
		if (body.defaultModel !== undefined) patch.default_model = body.defaultModel;
		if (body.theme !== undefined) patch.theme = body.theme;

		if (Object.keys(patch).length === 0) {
			throw new ApiError(400, "empty_update", "No profile changes were supplied.");
		}

		const { error } = await getServiceClient().from("a21_profiles").update(patch).eq("id", user.id);
		if (error) throw new ApiError(500, "profile_update_failed", "Could not update your profile.");

		return jsonOk({ profile: await getOrCreateProfile(user) });
	} catch (error) {
		return handleApiError(error);
	}
}
