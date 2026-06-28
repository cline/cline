import { describe, expect, it } from "vitest";
import {
	buildDashboardLaunchUrl,
	resolveClineHubServerOptions,
} from "./options";

describe("resolveClineHubServerOptions", () => {
	it("generates a room secret for local dashboard bridges by default", () => {
		const options = resolveClineHubServerOptions({});

		expect(options.host).toBe("127.0.0.1");
		expect(options.publicUrl).toBe("http://127.0.0.1:8787");
		expect(options.dashboardWebUrl).toBe("http://127.0.0.1:8787");
		expect(options.roomSecret).toMatch(/^[a-f0-9]{64}$/);
	});

	it("resolves a hosted dashboard web URL separately from the local bridge URL", () => {
		const options = resolveClineHubServerOptions({
			PUBLIC_URL: "http://127.0.0.1:8787/",
			CLINE_HUB_DASHBOARD_WEB_URL: "https://cline.bot/dashboard/",
			ROOM_SECRET: "invite-123",
		});

		expect(options.publicUrl).toBe("http://127.0.0.1:8787");
		expect(options.dashboardWebUrl).toBe("https://cline.bot/dashboard");
		expect(options.roomSecret).toBe("invite-123");
	});
});

describe("buildDashboardLaunchUrl", () => {
	it("puts local bridge credentials in the URL fragment", () => {
		expect(
			buildDashboardLaunchUrl(
				"https://cline.bot/dashboard",
				"http://127.0.0.1:8787",
				"invite-123",
			),
		).toBe(
			"https://cline.bot/dashboard#bridgeUrl=http%3A%2F%2F127.0.0.1%3A8787&roomSecret=invite-123",
		);
	});
});
