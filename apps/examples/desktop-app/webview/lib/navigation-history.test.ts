import { describe, expect, it } from "vitest";
import {
	createNavigationHistory,
	navigationHistoryReducer,
} from "./navigation-history";

type Location = {
	view: "chat" | "settings";
	thread: string;
	settingsSection: "General" | "Account";
};

const welcome: Location = {
	view: "chat",
	thread: "welcome",
	settingsSection: "General",
};
const account: Location = {
	view: "settings",
	thread: "welcome",
	settingsSection: "Account",
};
const oldSession: Location = {
	view: "chat",
	thread: "old-session",
	settingsSection: "Account",
};

describe("navigationHistoryReducer", () => {
	it("returns from an old session to the welcome chat and can go forward again", () => {
		let history = createNavigationHistory(welcome);
		history = navigationHistoryReducer(history, {
			type: "navigate",
			destination: oldSession,
		});
		history = navigationHistoryReducer(history, { type: "back" });
		expect(history.current).toEqual(welcome);
		history = navigationHistoryReducer(history, { type: "forward" });
		expect(history.current).toEqual(oldSession);
	});

	it("restores the account view after opening a session from settings", () => {
		let history = createNavigationHistory(account);
		history = navigationHistoryReducer(history, {
			type: "navigate",
			destination: oldSession,
		});
		history = navigationHistoryReducer(history, { type: "back" });
		expect(history.current).toEqual(account);
		history = navigationHistoryReducer(history, { type: "forward" });
		expect(history.current).toEqual(oldSession);
	});

	it("clears forward history after navigating somewhere new", () => {
		let history = createNavigationHistory(welcome);
		history = navigationHistoryReducer(history, {
			type: "navigate",
			destination: oldSession,
		});
		history = navigationHistoryReducer(history, { type: "back" });
		history = navigationHistoryReducer(history, {
			type: "navigate",
			destination: account,
		});
		expect(history.forward).toEqual([]);
	});
});
