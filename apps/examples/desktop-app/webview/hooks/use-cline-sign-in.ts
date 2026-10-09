import { useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { OAUTH_LOGIN_TIMEOUT_MS } from "@/lib/provider-connection";

export function useClineSignIn({
	onSuccess,
	onError,
	onSettled,
}: {
	onSuccess: (signal: AbortSignal) => Promise<void>;
	onError?: () => void;
	onSettled?: () => void;
}) {
	const controller = useRef<AbortController | null>(null);
	const [pending, setPending] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function signIn() {
		if (controller.current || cancelling) return;
		const attempt = new AbortController();
		controller.current = attempt;
		setPending(true);
		setError(null);
		try {
			await desktopClient.invoke(
				"run_provider_oauth_login",
				{ provider: "cline" },
				{ timeoutMs: OAUTH_LOGIN_TIMEOUT_MS, signal: attempt.signal },
			);
			await onSuccess(attempt.signal);
		} catch (error) {
			if (!attempt.signal.aborted) {
				setError(error instanceof Error ? error.message : String(error));
				onError?.();
			}
		} finally {
			controller.current = null;
			setPending(false);
			onSettled?.();
		}
	}

	async function cancelSignIn() {
		if (!controller.current || cancelling) return;
		controller.current.abort();
		setCancelling(true);
		setError(null);
		try {
			await desktopClient.invoke("cancel_provider_oauth_login", {
				provider: "cline",
			});
		} catch (error) {
			setError(
				`Could not cancel sign-in: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setCancelling(false);
		}
	}

	return {
		signIn,
		cancelSignIn,
		// Cancellation is provider-wide; both requests must finish before retry.
		signingIn: pending || cancelling,
		cancelling,
		error,
	};
}
