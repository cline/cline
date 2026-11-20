import { ApiError } from "@/lib/api";
import { decryptSecret, hashToolInput } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase/service";

export type ResolvedKey = {
	key: string;
	source: "user" | "server";
	last4: string;
};

export async function getUserOpenRouterKey(ownerId: string): Promise<ResolvedKey | null> {
	const { data, error } = await getServiceClient()
		.from("a21_provider_keys")
		.select("owner_id, ciphertext, iv, auth_tag, last4")
		.eq("owner_id", ownerId)
		.eq("provider", "openrouter")
		.maybeSingle();
	if (error) {
		throw new ApiError(500, "provider_key_lookup_failed", "Could not read saved API key.");
	}
	if (!data) return null;
	try {
		const key = decryptSecret({
			ciphertext: data.ciphertext as string,
			iv: data.iv as string,
			authTag: data.auth_tag as string,
		});
		return { key, source: "user", last4: data.last4 as string };
	} catch {
		throw new ApiError(
			500,
			"provider_key_decrypt_failed",
			"Your saved API key could not be decrypted. Remove and re-add it.",
		);
	}
}

export async function resolveOpenRouterKey(ownerId: string): Promise<ResolvedKey> {
	const userKey = await getUserOpenRouterKey(ownerId);
	if (userKey) return userKey;
	const serverKey = process.env.OPENROUTER_API_KEY;
	if (!serverKey) {
		throw new ApiError(
			503,
			"openrouter_not_configured",
			"No OpenRouter key is configured. Ask the operator to set OPENROUTER_API_KEY or add your own key in Settings.",
		);
	}
	return { key: serverKey, source: "server", last4: serverKey.slice(-4) };
}

export async function validateOpenRouterKey(key: string): Promise<{
	valid: boolean;
	label?: string;
	usage?: number;
	limit?: number | null;
	isFreeTier?: boolean;
}> {
	const baseUrl = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(
		/\/$/,
		"",
	);
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/key`, {
			headers: {
				Authorization: `Bearer ${key}`,
				Accept: "application/json",
				"HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
				"X-Title": process.env.OPENROUTER_APP_NAME ?? "21 Agent",
			},
			signal: AbortSignal.timeout(15_000),
			cache: "no-store",
		});
	} catch {
		throw new ApiError(504, "provider_timeout", "Could not reach OpenRouter to validate that key.");
	}

	if (response.status === 401 || response.status === 403) {
		return { valid: false };
	}
	if (!response.ok) {
		throw new ApiError(502, "provider_error", "OpenRouter rejected the validation request.");
	}
	const payload = (await response.json().catch(() => ({}))) as {
		data?: { label?: string; usage?: number; limit?: number | null; is_free_tier?: boolean };
	};
	return {
		valid: true,
		label: payload.data?.label,
		usage: payload.data?.usage,
		limit: payload.data?.limit ?? null,
		isFreeTier: payload.data?.is_free_tier,
	};
}

export function keyFingerprint(key: string): string {
	return hashToolInput({ provider: "openrouter", key });
}
