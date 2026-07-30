import { describe, expect, it } from "vitest";
import {
	resolveDriveCallError,
	shouldReattachDriveSession,
} from "./useDriveSession";

describe("Drive call error transitions", () => {
	it("clears a stale missing room without requesting another refresh", () => {
		expect(
			resolveDriveCallError({
				code: "room_not_found",
				command: "call_get_room",
				text: "room_not_found:default",
				wasJoining: false,
			}),
		).toEqual({
			kind: "reset",
			note: "The Drive call is no longer available.",
			phase: "off",
		});
	});

	it("makes a failed join retryable", () => {
		expect(
			resolveDriveCallError({
				code: "room_not_found",
				command: "call_join",
				text: "room_not_found:default",
				wasJoining: true,
			}),
		).toEqual({
			kind: "reset",
			note: "Could not join Drive: room_not_found:default",
			phase: "error",
		});
	});

	it("refreshes after a recoverable in-call command error", () => {
		expect(
			resolveDriveCallError({
				command: "call_rename_participant",
				text: "duplicate name",
				wasJoining: false,
			}),
		).toEqual({
			kind: "refresh",
			note: "Could not rename participant: duplicate name",
		});
	});
});

describe("Drive session reattachment", () => {
	it("reattaches a new Chat session once while the call is active", () => {
		expect(
			shouldReattachDriveSession({
				active: true,
				connectionPhase: "on",
				driveIntended: true,
				lastAttachedSessionId: "session-1",
				sessionId: "session-2",
			}),
		).toBe(true);
		expect(
			shouldReattachDriveSession({
				active: true,
				connectionPhase: "on",
				driveIntended: true,
				lastAttachedSessionId: "session-2",
				sessionId: "session-2",
			}),
		).toBe(false);
	});

	it("does not attach before the call is seated", () => {
		expect(
			shouldReattachDriveSession({
				active: false,
				connectionPhase: "joining",
				driveIntended: true,
				lastAttachedSessionId: null,
				sessionId: "session-2",
			}),
		).toBe(false);
	});
});
