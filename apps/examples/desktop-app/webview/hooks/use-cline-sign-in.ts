import { useEffect, useRef, useState } from "react";
import {
	cancelClineOAuthLogin,
	runProviderOAuthLogin,
} from "@/lib/provider-connection";

export function useClineSignIn({
	onSuccess,
	onSettled,
}: {
	onSuccess: (signal: AbortSignal) => Promise<void>;
	onSettled?: () => void;
}) {
	const controller = useRef<AbortController | null>(null);
	const [pending, setPending] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => () => controller.current?.abort(), []);

	async function signIn() {
		if (controller.current || cancelling) return;
		const attempt = new AbortController();
		controller.current = attempt;
		setPending(true);
		setError(null);
		try {
			await runProviderOAuthLogin("cline", attempt.signal);
			await onSuccess(attempt.signal);
		} catch (error) {
			if (!attempt.signal.aborted) {
				setError(error instanceof Error ? error.message : String(error));
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
			await cancelClineOAuthLogin();
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
