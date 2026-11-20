import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/app"];
const AUTH_PAGES = ["/sign-in", "/sign-up"];

export async function updateSession(request: NextRequest) {
	let response = NextResponse.next({ request });

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !anonKey) {
		return { response, user: null, configured: false as const };
	}

	const supabase = createServerClient(url, anonKey, {
		cookies: {
			getAll() {
				return request.cookies.getAll();
			},
			setAll(cookiesToSet) {
				for (const { name, value } of cookiesToSet) {
					request.cookies.set(name, value);
				}
				response = NextResponse.next({ request });
				for (const { name, value, options } of cookiesToSet) {
					response.cookies.set(name, value, options);
				}
			},
		},
	});

	// getUser() validates the JWT with Supabase Auth; do not trust getSession().
	const {
		data: { user },
	} = await supabase.auth.getUser();

	const path = request.nextUrl.pathname;
	const isProtected = PROTECTED_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);

	if (isProtected && !user) {
		const redirect = request.nextUrl.clone();
		redirect.pathname = "/sign-in";
		redirect.searchParams.set("next", path);
		return { response: NextResponse.redirect(redirect), user: null, configured: true as const };
	}

	if (user && AUTH_PAGES.includes(path)) {
		const redirect = request.nextUrl.clone();
		redirect.pathname = "/app";
		redirect.search = "";
		return { response: NextResponse.redirect(redirect), user, configured: true as const };
	}

	return { response, user, configured: true as const };
}
