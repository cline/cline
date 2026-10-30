import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
	const { response } = await updateSession(request);
	return response;
}

export const config = {
	matcher: [
		/*
		 * Match all request paths except static assets and image files so the
		 * Supabase session is refreshed consistently across app routes.
		 */
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|css|js)$).*)",
	],
};
