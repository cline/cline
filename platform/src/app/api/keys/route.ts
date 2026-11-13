import { ApiError, handleApiError, jsonOk, readJson, sanitizeLogMessage } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { encryptSecret, lastFour } from "@/lib/crypto";
import { validateOpenRouterKey } from "@/lib/openrouter/keys";
import { getOrCreateProfile, hasPersonalOpenRouterKey } from "@/lib/profile";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/service";
import { providerKeySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
	try {
		const user = await requireUser();
		const personal = await hasPersonalOpenRouterKey(user.id);
		const { data } = await getServiceClient()
			.from("a21_provider_keys")
			.select("last4, updated_at")
			.eq("owner_id", user.id)
			.eq("provider", "openrouter")
			.maybeSingle();

		return jsonOk({
			personal,
			last4: data?.last4 ?? null,
			updatedAt: data?.updated_at ?? null,
			serverConfigured: Boolean(process.env.OPENROUTER_API_KEY),
		});
	} catch (error) {
		return handleApiError(error);
	}
}

export async function POST(request: Request) {
	try {
		const user = await requireUser();
		const profile = await getOrCreateProfile(user);
		await enforceRateLimit(user.id, "providerKey");
		const body = await readJson(request, providerKeySchema);

		// Validate before storing so a typo never breaks an in-flight task.
		const validation = await validateOpenRouterKey(body.key);
		if (!validation.valid) {
			throw new ApiError(400, "invalid_key", "OpenRouter rejected that key. Check and try again.");
		}

		const encrypted = encryptSecret(body.key);
		const { error } = await getServiceClient()
			.from("a21_provider_keys")
			.upsert(
				{
					owner_id: user.id,
					provider: "openrouter",
					ciphertext: encrypted.ciphertext,
					iv: encrypted.iv,
					auth_tag: encrypted.authTag,
					last4: lastFour(body.key),
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "owner_id" },
			);
		if (error) {
			console.error("[21-agent] provider key save failed:", sanitizeLogMessage(error.message));
			throw new ApiError(500, "key_save_failed", "Could not store the key securely.");
		}

		await getServiceClient()
			.from("a21_audit_logs")
			.insert({
				owner_id: user.id,
				action: "provider_key.saved",
				resource_type: "a21_provider_key",
				resource_id: null,
				metadata: { provider: "openrouter", last4: lastFour(body.key), plan: profile.plan },
			});

		return jsonOk({
			saved: true,
			last4: lastFour(body.key),
			label: validation.label ?? null,
			usage: validation.usage ?? null,
			limit: validation.limit ?? null,
		});
	} catch (error) {
		return handleApiError(error);
	}
}

export async function DELETE() {
	try {
		const user = await requireUser();
		const { error } = await getServiceClient()
			.from("a21_provider_keys")
			.delete()
			.eq("owner_id", user.id)
			.eq("provider", "openrouter");
		if (error) throw new ApiError(500, "key_delete_failed", "Could not remove the key.");

		await getServiceClient()
			.from("a21_audit_logs")
			.insert({
				owner_id: user.id,
				action: "provider_key.removed",
				resource_type: "a21_provider_key",
				metadata: { provider: "openrouter" },
			});
		return jsonOk({ removed: true });
	} catch (error) {
		return handleApiError(error);
	}
}
