export type NavigationHistory<T> = {
	back: T[];
	current: T;
	forward: T[];
};

export type NavigationHistoryAction<T> =
	| { type: "navigate"; destination: T }
	| { type: "back" }
	| { type: "forward" }
	| { type: "replace"; destination: T };

export function createNavigationHistory<T>(
	initialLocation: T,
): NavigationHistory<T> {
	return {
		back: [],
		current: initialLocation,
		forward: [],
	};
}

export function navigationHistoryReducer<T>(
	state: NavigationHistory<T>,
	action: NavigationHistoryAction<T>,
): NavigationHistory<T> {
	switch (action.type) {
		case "navigate":
			return {
				back: [...state.back, state.current],
				current: action.destination,
				forward: [],
			};
		case "back": {
			const destination = state.back.at(-1);
			if (!destination) return state;
			return {
				back: state.back.slice(0, -1),
				current: destination,
				forward: [state.current, ...state.forward],
			};
		}
		case "forward": {
			const destination = state.forward[0];
			if (!destination) return state;
			return {
				back: [...state.back, state.current],
				current: destination,
				forward: state.forward.slice(1),
			};
		}
		case "replace":
			return {
				...state,
				current: action.destination,
			};
	}
}
