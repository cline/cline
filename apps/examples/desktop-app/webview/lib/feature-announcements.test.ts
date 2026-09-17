// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	claimFeatureAnnouncement,
	FEATURE_ANNOUNCEMENTS_STORAGE_KEY,
	hasSeenFeatureAnnouncement,
	markFeatureAnnouncementSeen,
	parseFeatureAnnouncementStorage,
} from "./feature-announcements";

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("parseFeatureAnnouncementStorage", () => {
	it("treats missing or malformed payloads as nothing seen", () => {
		expect(parseFeatureAnnouncementStorage(null).seen).toEqual({});
		expect(parseFeatureAnnouncementStorage("").seen).toEqual({});
		expect(parseFeatureAnnouncementStorage("not json").seen).toEqual({});
		expect(parseFeatureAnnouncementStorage("[]").seen).toEqual({});
		expect(parseFeatureAnnouncementStorage('{"seen":[]}').seen).toEqual({});
		expect(
			parseFeatureAnnouncementStorage('{"seen":{"ssh-remote-environments":42}}')
				.seen,
		).toEqual({});
		expect(
			parseFeatureAnnouncementStorage(
				'{"seen":{"ssh-remote-environments":" "}}',
			).seen,
		).toEqual({});
	});

	it("keeps valid timestamps", () => {
		expect(
			parseFeatureAnnouncementStorage(
				'{"seen":{"ssh-remote-environments":"2026-09-17T00:00:00.000Z"}}',
			).seen,
		).toEqual({ "ssh-remote-environments": "2026-09-17T00:00:00.000Z" });
	});
});

describe("feature announcement state round-trip", () => {
	it("starts unseen and persists once marked", () => {
		expect(hasSeenFeatureAnnouncement("ssh-remote-environments")).toBe(false);

		markFeatureAnnouncementSeen("ssh-remote-environments");
		expect(hasSeenFeatureAnnouncement("ssh-remote-environments")).toBe(true);
		expect(
			parseFeatureAnnouncementStorage(
				window.localStorage.getItem(FEATURE_ANNOUNCEMENTS_STORAGE_KEY),
			).seen["ssh-remote-environments"],
		).toEqual(expect.any(String));
	});

	it("treats unreadable storage as seen so the spotlight cannot nag every launch", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("storage disabled");
		});
		expect(hasSeenFeatureAnnouncement("ssh-remote-environments")).toBe(true);
	});
});

describe("claimFeatureAnnouncement", () => {
	it("opens once for an existing install and never again", () => {
		expect(
			claimFeatureAnnouncement("ssh-remote-environments", {
				onboardingCompleted: true,
			}),
		).toBe(true);
		expect(
			claimFeatureAnnouncement("ssh-remote-environments", {
				onboardingCompleted: true,
			}),
		).toBe(false);
	});

	it("skips a fresh install without leaving it pending for a later launch", () => {
		expect(
			claimFeatureAnnouncement("ssh-remote-environments", {
				onboardingCompleted: false,
			}),
		).toBe(false);
		expect(hasSeenFeatureAnnouncement("ssh-remote-environments")).toBe(true);
		expect(
			claimFeatureAnnouncement("ssh-remote-environments", {
				onboardingCompleted: true,
			}),
		).toBe(false);
	});
});
