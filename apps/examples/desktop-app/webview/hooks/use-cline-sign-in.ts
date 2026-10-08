import { useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { OAUTH_LOGIN_TIMEOUT_MS } from "@/lib/provider-connection";

type SignInAttempt = {
	cancelling: boolean;
	settled: boolean;
	controller: AbortController;
};

export function useClineSignIn() {
	const [status, setStatus] = useState<"idle" | "pending" | "cancelling">(
		"idle",
	);
	const [error, setError] = useState<string | null>(null);
	const activeAttempt = useRef<SignInAttempt | null>(null);

	useEffect(
		() => () => {
			activeAttempt.current = null;
		},
		[],
	);

	async function signIn(): Promise<{ signedIn: boolean; cancelled: boolean }> {
		if (activeAttempt.current) return { signedIn: false, cancelled: true };
		const attempt = {
			cancelling: false,
			settled: false,
			controller: new AbortController(),
		};
		activeAttempt.current = attempt;
		setStatus("pending");
		setError(null);
		try {
			await desktopClient.invoke(
				"run_provider_oauth_login",
				{ provider: "cline" },
				{
					timeoutMs: OAUTH_LOGIN_TIMEOUT_MS,
					signal: attempt.controller.signal,
				},
			);
			return {
				signedIn: true,
				cancelled: activeAttempt.current !== attempt || attempt.cancelling,
			};
		} catch (error) {
			if (activeAttempt.current === attempt && !attempt.cancelling) {
				throw error;
			}
			return { signedIn: false, cancelled: true };
		} finally {
			attempt.settled = true;
			if (activeAttempt.current === attempt && !attempt.cancelling) {
				activeAttempt.current = null;
				setStatus("idle");
			}
		}
	}

	async function cancelSignIn(): Promise<boolean> {
		const attempt = activeAttempt.current;
		if (!attempt || attempt.cancelling) return false;
		attempt.cancelling = true;
		attempt.controller.abort();
		setStatus("cancelling");
		setError(null);
		try {
			// Cancellation is provider-wide: do not allow a new login until it settles.
			await desktopClient.invoke("cancel_provider_oauth_login", {
				provider: "cline",
			});
			if (activeAttempt.current === attempt) {
				activeAttempt.current = null;
				setStatus("idle");
			}
			return true;
		} catch (error) {
			if (activeAttempt.current === attempt) {
				setError(
					`Could not cancel sign-in: ${error instanceof Error ? error.message : String(error)}`,
				);
				if (attempt.settled) activeAttempt.current = null;
				setStatus(attempt.settled ? "idle" : "pending");
			}
			return false;
		} finally {
			attempt.cancelling = false;
		}
	}

	return {
		signIn,
		cancelSignIn,
		signingIn: status !== "idle",
		cancelling: status === "cancelling",
		error,
	};
}
