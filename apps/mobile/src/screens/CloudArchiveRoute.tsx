import { useCallback, useEffect, useState } from "react";
import { CloudSessionGateway, cloudAuthStore } from "@/cloud";
import { cloudEnv } from "@/config/env";
import type { ConnectionDescriptor } from "@/connection";
import { userErrorMessage } from "@/error-message";
import { asRemoteSessionId } from "@/session";
import { ArchivedChatScreen } from "./ArchivedChatScreen";

/** A terminal workspace is read over REST, never attached to a different Hub task. */
export function CloudArchiveRoute({
	descriptor,
	onBack,
	onNewChat,
	onSignIn,
	notice,
}: {
	descriptor: ConnectionDescriptor;
	onBack(): void;
	onNewChat(): void;
	onSignIn(): void;
	notice?: string;
}) {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<{
		loading: boolean;
		history?: unknown[];
		error?: Error;
	}>({ loading: true });
	const retry = useCallback(() => setAttempt((value) => value + 1), []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally triggers a fresh history request when the user retries.
	useEffect(() => {
		let retired = false;
		setState({ loading: true });
		const gateway = new CloudSessionGateway({
			apiBaseUrl: descriptor.apiBaseUrl ?? cloudEnv.apiBaseUrl,
			getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			...(descriptor.organizationId
				? { organizationId: descriptor.organizationId }
				: {}),
		});
		void gateway
			.readHistory(asRemoteSessionId(descriptor.remoteSessionId!))
			.then(
				(history) => {
					if (!retired)
						setState({ loading: false, ...(history ? { history } : {}) });
				},
				(error) => {
					if (!retired)
						setState({
							loading: false,
							error:
								error instanceof Error
									? error
									: new Error(
											userErrorMessage(
												error,
												"The saved conversation could not be loaded.",
											),
										),
						});
				},
			);
		return () => {
			retired = true;
		};
	}, [
		descriptor.apiBaseUrl,
		descriptor.organizationId,
		descriptor.remoteSessionId,
		attempt,
	]);
	return (
		<ArchivedChatScreen
			{...state}
			notice={notice}
			title={descriptor.sessionTitle || descriptor.label}
			onRetry={retry}
			onBack={onBack}
			onNewChat={onNewChat}
			onSignIn={onSignIn}
		/>
	);
}
