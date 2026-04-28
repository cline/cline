import type { AgentEvent, TeamEvent } from "@clinebot/core";
import type React from "react";
import { createContext, useEffect, useRef } from "react";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../../runtime/session-events";
import type { TuiProps } from "../types";

interface EventBridgeHandlers {
	onAgentEvent: (event: AgentEvent) => void;
	onTeamEvent: (event: TeamEvent) => void;
	onPendingPrompts: (event: PendingPromptSnapshot) => void;
	onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
}

const EventBridgeContext = createContext<null>(null);

export function EventBridgeProvider(props: {
	subscribeToEvents: TuiProps["subscribeToEvents"];
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
