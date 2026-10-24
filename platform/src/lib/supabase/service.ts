import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/env";

let serviceClient: SupabaseClient | undefined;

/**
 * Service-role client. Never import this module from a Client Component.
 * The worker and API routes use it only after independently authenticating the
 * user and checking resource ownership.
 */
export function getServiceClient(): SupabaseClient {
	if (serviceClient) return serviceClient;

	const { url } = getPublicSupabaseConfig();
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!serviceRoleKey) {
		throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
	}

	serviceClient = createClient(url, serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false,
		},
		global: {
			headers: { "X-Client-Info": "21-agent-service" },
		},
	});

	return serviceClient;
}
