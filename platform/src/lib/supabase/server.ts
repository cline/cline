import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "@/lib/env";

export async function createSupabaseServerClient() {
	const { url, anonKey } = getPublicSupabaseConfig();
	const cookieStore = await cookies();

	return createServerClient(url, anonKey, {
		cookies: {
			getAll() {
				return cookieStore.getAll();
			},
			setAll(cookiesToSet) {
				try {
					for (const { name, value, options } of cookiesToSet) {
						cookieStore.set(name, value, options);
					}
				} catch {
					// Server Components cannot mutate cookies. The middleware refreshes
					// the session before the component renders, so this is safe to ignore.
				}
			},
		},
	});
}
