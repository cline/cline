import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/contexts/account-context";
import { desktopClient } from "@/lib/desktop-client";
import { OAUTH_LOGIN_TIMEOUT_MS } from "@/lib/provider-connection";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";

type SignInAttempt = {
	cancelling: boolean;
	settled: boolean;
};

export function useClineSignIn() {
	const { refreshAccount } = useAccount();
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

	async function signIn(): Promise<boolean> {
		if (activeAttempt.current) return false;
		const attempt = { cancelling: false, settled: false };
		activeAttempt.current = attempt;
		setStatus("pending");
		setError(null);
		try {
			await desktopClient
				.invoke(
					"run_provider_oauth_login",
					{ provider: "cline" },
					{ timeoutMs: OAUTH_LOGIN_TIMEOUT_MS },
				)
				.finally(invalidateProviderCatalogCache);
			await refreshAccount();
			return activeAttempt.current === attempt && !attempt.cancelling;
		} catch (error) {
			// Reconcile any saved credentials without delaying the error or retry.
			void refreshAccount();
			if (activeAttempt.current === attempt && !attempt.cancelling) {
				setError(error instanceof Error ? error.message : String(error));
			}
			return false;
		} finally {
			attempt.settled = true;
			if (activeAttempt.current === attempt && !attempt.cancelling) {
				activeAttempt.current = null;
				setStatus("idle");
			}
		}
	}

	async function cancelSignIn(): Promise<void> {
		const attempt = activeAttempt.current;
		if (!attempt || attempt.cancelling) return;
		attempt.cancelling = true;
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
		} catch (error) {
			if (activeAttempt.current === attempt) {
				setError(
					`Could not cancel sign-in: ${error instanceof Error ? error.message : String(error)}`,
				);
				if (attempt.settled) activeAttempt.current = null;
				setStatus(attempt.settled ? "idle" : "pending");
			}
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
