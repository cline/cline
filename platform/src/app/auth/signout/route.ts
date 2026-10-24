import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
	const supabase = await createSupabaseServerClient();
	await supabase.auth.signOut();
	const redirect = request.nextUrl.clone();
	redirect.pathname = "/sign-in";
	redirect.search = "";
	redirect.searchParams.set("signedOut", "1");
	return NextResponse.redirect(redirect, { status: 303 });
}
