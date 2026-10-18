import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({
	searchParams,
}: {
	searchParams: Promise<{ email?: string }>;
}) {
	const { email } = await searchParams;

	return (
		<div className="w-full max-w-sm">
			<span className="grid size-11 place-items-center rounded-xl border border-signal-500/25 bg-signal-500/10 text-signal-300">
				<MailCheck className="size-5" strokeWidth={1.7} />
			</span>
			<h1 className="display mt-6 text-3xl font-semibold">Check your inbox</h1>
			<p className="mt-3 text-[0.8125rem] leading-relaxed text-mist-500">
				We sent a verification link{email ? ` to ${email}` : ""}. Open it to activate your account,
				then come back and sign in.
			</p>
			<div className="mt-6 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-xs leading-relaxed text-mist-500">
				<p className="mb-1 font-medium text-mist-300">Link expired or never arrived?</p>
				<p>
					Sign-in will offer a resend option once you try. If this deployment has no outbound mail
					provider configured, the operator may need to confirm accounts manually in Supabase.
				</p>
			</div>
			<div className="mt-6 flex gap-3">
				<Link href="/sign-in" className="btn btn-primary flex-1">
					Go to sign in
				</Link>
				<Link href="/" className="btn btn-secondary">
					Home
				</Link>
			</div>
		</div>
	);
}
