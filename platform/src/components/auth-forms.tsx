"use client";

import { ArrowRight, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

function callbackUrl(next: string): string {
	const origin = window.location.origin;
	return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function AuthForm({ mode }: { mode: Mode }) {
	const router = useRouter();
	const params = useSearchParams();
	const next = params.get("next") || "/app";
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(params.get("error"));
	const [notice, setNotice] = useState<string | null>(
		params.get("signedOut") ? "You have been signed out." : null,
	);

	const supabase = getSupabaseBrowserClient();

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		setNotice(null);

		try {
			if (mode === "sign-in") {
				const { error: signInError } = await supabase.auth.signInWithPassword({
					email: email.trim(),
					password,
				});
				if (signInError) {
					if (/email not confirmed/i.test(signInError.message)) {
						setError(
							"Your email is not confirmed yet. Open the verification link, or resend it below.",
						);
					} else {
						setError(signInError.message);
					}
					return;
				}
				router.push(next.startsWith("/") ? next : "/app");
				router.refresh();
				return;
			}

			if (mode === "sign-up") {
				const { data, error: signUpError } = await supabase.auth.signUp({
					email: email.trim(),
					password,
					options: { emailRedirectTo: callbackUrl("/app") },
				});
				if (signUpError) {
					setError(signUpError.message);
					return;
				}
				if (data.session) {
					router.push("/app");
					router.refresh();
					return;
				}
				router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
				return;
			}

			if (mode === "forgot") {
				const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
					redirectTo: callbackUrl("/reset-password"),
				});
				if (resetError) {
					setError(resetError.message);
					return;
				}
				setNotice(
					"If an account exists for that address, a password reset link is on its way. Check the inbox and spam folder.",
				);
				return;
			}

			if (mode === "reset") {
				const { error: updateError } = await supabase.auth.updateUser({ password });
				if (updateError) {
					setError(updateError.message);
					return;
				}
				setNotice("Password updated. Taking you to your workspace…");
				setTimeout(() => {
					router.push("/app");
					router.refresh();
				}, 700);
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Something went wrong.");
		} finally {
			setBusy(false);
		}
	}

	async function resendConfirmation() {
		if (!email.trim()) {
			setError("Enter your email address first.");
			return;
		}
		setBusy(true);
		setError(null);
		const { error: resendError } = await supabase.auth.resend({
			type: "signup",
			email: email.trim(),
			options: { emailRedirectTo: callbackUrl("/app") },
		});
		setBusy(false);
		if (resendError) {
			setError(resendError.message);
			return;
		}
		setNotice("Verification email sent again. Check your inbox.");
	}

	const titles: Record<Mode, { title: string; subtitle: string; cta: string }> = {
		"sign-in": {
			title: "Welcome back",
			subtitle: "Sign in to your projects, tasks and workspaces.",
			cta: "Sign in",
		},
		"sign-up": {
			title: "Create your account",
			subtitle: "Start with a free workspace. No credit card required.",
			cta: "Create account",
		},
		forgot: {
			title: "Reset your password",
			subtitle: "We will send a recovery link to your email address.",
			cta: "Send recovery link",
		},
		reset: {
			title: "Choose a new password",
			subtitle: "Use at least 6 characters. Longer is better.",
			cta: "Update password",
		},
	};

	const copy = titles[mode];
	const needsEmail = mode !== "reset";

	return (
		<div className="w-full max-w-sm">
			<p className="eyebrow">{mode === "sign-up" ? "Get started" : "Account"}</p>
			<h1 className="display mt-3 text-3xl font-semibold">{copy.title}</h1>
			<p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-500">{copy.subtitle}</p>

			<form onSubmit={onSubmit} className="mt-7 space-y-4">
				{needsEmail ? (
					<div>
						<label htmlFor="email" className="label">
							Email
						</label>
						<input
							id="email"
							type="email"
							autoComplete="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="you@company.com"
							className="input"
						/>
					</div>
				) : null}

				{mode !== "forgot" ? (
					<div>
						<div className="flex items-center justify-between">
							<label htmlFor="password" className="label">
								Password
							</label>
							{mode === "sign-in" ? (
								<Link
									href="/forgot-password"
									className="mb-1 text-[0.6875rem] text-mist-500 hover:text-mist-200"
								>
									Forgot?
								</Link>
							) : null}
						</div>
						<div className="relative">
							<input
								id="password"
								type={showPassword ? "text" : "password"}
								autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
								required
								minLength={6}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								placeholder="••••••••••"
								className="input pr-10"
							/>
							<button
								type="button"
								onClick={() => setShowPassword((value) => !value)}
								className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-mist-500 hover:bg-white/5 hover:text-mist-200"
								aria-label={showPassword ? "Hide password" : "Show password"}
							>
								{showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
							</button>
						</div>
					</div>
				) : null}

				{error ? (
					<div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2.5 text-xs leading-relaxed text-rose-200">
						{error}
						{mode === "sign-in" && /not confirmed/i.test(error) ? (
							<button
								type="button"
								onClick={resendConfirmation}
								className="mt-2 block font-medium text-rose-100 underline underline-offset-2"
							>
								Resend verification email
							</button>
						) : null}
					</div>
				) : null}

				{notice ? (
					<div className="flex gap-2 rounded-lg border border-signal-500/20 bg-signal-500/[0.06] px-3 py-2.5 text-xs leading-relaxed text-signal-200">
						<MailCheck className="mt-0.5 size-3.5 shrink-0" />
						{notice}
					</div>
				) : null}

				<button type="submit" disabled={busy} className="btn btn-primary w-full">
					{busy ? <Loader2 className="size-4 animate-spin" /> : null}
					{copy.cta}
					{!busy ? <ArrowRight className="size-3.5" /> : null}
				</button>
			</form>

			<div className="mt-6 space-y-2 text-center text-xs text-mist-500">
				{mode === "sign-in" ? (
					<p>
						New to 21 Agent?{" "}
						<Link href="/sign-up" className="font-medium text-signal-300 hover:text-signal-200">
							Create an account
						</Link>
					</p>
				) : null}
				{mode === "sign-up" ? (
					<p>
						Already have an account?{" "}
						<Link href="/sign-in" className="font-medium text-signal-300 hover:text-signal-200">
							Sign in
						</Link>
					</p>
				) : null}
				{mode === "forgot" || mode === "reset" ? (
					<p>
						<Link href="/sign-in" className="font-medium text-mist-300 hover:text-mist-100">
							Back to sign in
						</Link>
					</p>
				) : null}
				{mode === "sign-up" ? (
					<p className="pt-2 text-[0.65rem] leading-relaxed text-mist-600">
						By continuing you agree that agent-provided code must be reviewed before production use.
					</p>
				) : null}
			</div>
		</div>
	);
}
