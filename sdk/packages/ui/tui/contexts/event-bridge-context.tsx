import type {
	AgentEvent,
	TeamUiEvent,
	UiPendingPromptSubmitted,
	UiPendingPromptsState,
} from "@cline/shared";
import type React from "react";
import { createContext, useEffect, useRef } from "react";
import type { InteractiveTerminalUiProps } from "../types";

interface EventBridgeHandlers {
	onAgentEvent: (event: AgentEvent) => void;
	onTeamEvent: (event: TeamUiEvent) => void;
	onPendingPrompts: (event: UiPendingPromptsState) => void;
	onPendingPromptSubmitted: (event: UiPendingPromptSubmitted) => void;
}

const EventBridgeContext = createContext<null>(null);

export function EventBridgeProvider(props: {
	subscribeToEvents: InteractiveTerminalUiProps["subscribeToEvents"];
	handlers: EventBridgeHandlers;
	children: React.ReactNode;
}) {
	const handlersRef = useRef(props.handlers);
	handlersRef.current = props.handlers;

	const subscribeRef = useRef(props.subscribeToEvents);
	subscribeRef.current = props.subscribeToEvents;

	useEffect(() => {
		const unsubscribe = subscribeRef.current({
			onAgentEvent: (event) => handlersRef.current.onAgentEvent(event),
			onTeamEvent: (event) => handlersRef.current.onTeamEvent(event),
			onPendingPrompts: (event) => handlersRef.current.onPendingPrompts(event),
			onPendingPromptSubmitted: (event) =>
				handlersRef.current.onPendingPromptSubmitted(event),
		});
		return unsubscribe;
	}, []);

	return (
		<EventBridgeContext.Provider value={null}>
			{props.children}
		</EventBridgeContext.Provider>
	);
}
