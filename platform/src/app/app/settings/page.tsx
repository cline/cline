import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { requireUser } from "@/lib/auth";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile, getOrCreateSettings, hasPersonalOpenRouterKey } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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

	return (
		<SettingsView
			user={{
				id: user.id,
				email: user.email ?? profile.email,
				createdAt: user.created_at,
			}}
			initialProfile={profile}
			initialSettings={settings}
			limits={limitsForPlan(profile.plan)}
			keyInfo={{
				personal: personalKey,
				last4: (keyRow?.last4 as string | undefined) ?? null,
				updatedAt: (keyRow?.updated_at as string | undefined) ?? null,
				serverConfigured: Boolean(process.env.OPENROUTER_API_KEY),
				sandboxConfigured: Boolean(process.env.DAYTONA_API_KEY),
			}}
		/>
	);
}
