import type { User } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProfileRow, SettingsRow } from "@/lib/types";

function displayNameFrom(user: User): string | null {
	const metadata = user.user_metadata ?? {};
	const candidate =
		(typeof metadata.display_name === "string" && metadata.display_name) ||
		(typeof metadata.full_name === "string" && metadata.full_name) ||
		(typeof metadata.name === "string" && metadata.name) ||
		null;
	return candidate ? candidate.slice(0, 80) : null;
}

export async function getOrCreateProfile(user: User): Promise<ProfileRow> {
	const client = getServiceClient();
	const { data, error } = await client
		.from("a21_profiles")
		.select("*")
		.eq("id", user.id)
		.maybeSingle();
	if (error) {
		throw new ApiError(500, "profile_lookup_failed", "Could not load your profile.");
	}
	if (data) {
		const row = data as ProfileRow;
		if (row.email !== (user.email ?? "")) {
			await client
				.from("a21_profiles")
				.update({ email: user.email ?? "" })
				.eq("id", user.id);
			row.email = user.email ?? "";
		}
		return row;
	}

	const { data: created, error: createError } = await client
		.from("a21_profiles")
		.upsert(
			{
				id: user.id,
				email: user.email ?? "",
				display_name: displayNameFrom(user),
			},
			{ onConflict: "id" },
		)
		.select("*")
		.single();
	if (createError || !created) {
		throw new ApiError(500, "profile_create_failed", "Could not initialize your profile.");
	}
	return created as ProfileRow;
}

export async function getOrCreateSettings(ownerId: string): Promise<SettingsRow> {
	const client = getServiceClient();
	const { data, error } = await client
		.from("a21_settings")
		.select("*")
		.eq("owner_id", ownerId)
		.maybeSingle();
	if (error) {
		throw new ApiError(500, "settings_lookup_failed", "Could not load your settings.");
	}
	if (data) return data as SettingsRow;

	const { data: created, error: createError } = await client
		.from("a21_settings")
		.upsert({ owner_id: ownerId }, { onConflict: "owner_id" })
		.select("*")
		.single();
	if (createError || !created) {
		throw new ApiError(500, "settings_create_failed", "Could not initialize your settings.");
	}
	return created as SettingsRow;
}

export async function hasPersonalOpenRouterKey(ownerId: string): Promise<boolean> {
	const { data } = await getServiceClient()
		.from("a21_provider_keys")
		.select("owner_id")
		.eq("owner_id", ownerId)
		.eq("provider", "openrouter")
		.maybeSingle();
	return Boolean(data);
}
