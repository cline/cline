import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNext(value: string | null): string {
	if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
	return value;
}

export async function GET(request: NextRequest) {
	const url = request.nextUrl;
	const code = url.searchParams.get("code");
	const tokenHash = url.searchParams.get("token_hash");
	const type = url.searchParams.get("type");
	const next = safeNext(url.searchParams.get("next"));
	const errorDescription = url.searchParams.get("error_description");

	if (errorDescription) {
		const redirect = url.clone();
		redirect.pathname = "/sign-in";
		redirect.search = "";
		redirect.searchParams.set("error", "Verification link could not be used. Request a new one.");
		return NextResponse.redirect(redirect);
	}

	const supabase = await createSupabaseServerClient();

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			const redirect = url.clone();
			redirect.pathname = next;
			redirect.search = "";
			return NextResponse.redirect(redirect);
		}
	}

	if (tokenHash && type) {
		const { error } = await supabase.auth.verifyOtp({
			token_hash: tokenHash,
			type: type as "signup" | "email" | "recovery" | "email_change" | "invite" | "magiclink",
		});
		if (!error) {
			const redirect = url.clone();
			redirect.pathname = next;
			redirect.search = "";
			return NextResponse.redirect(redirect);
		}
	}

	const redirect = url.clone();
	redirect.pathname = "/sign-in";
	redirect.search = "";
	redirect.searchParams.set("error", "That link is invalid or expired. Request a new email.");
	return NextResponse.redirect(redirect);
}
