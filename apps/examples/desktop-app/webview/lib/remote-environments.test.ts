import { describe, expect, it } from "vitest";
import {
	createRemoteEnvironmentDraft,
	formatRemoteEnvironmentDestination,
	normalizeRemoteEnvironmentProfile,
	validateRemoteEnvironmentProfile,
} from "./remote-environments";

describe("remote environment models", () => {
	it("leaves a new profile port blank so SSH config can supply it", () => {
		expect(createRemoteEnvironmentDraft()).toEqual({
			id: undefined,
			name: "",
			host: "",
			user: undefined,
			port: undefined,
			identityFile: undefined,
		});
	});

	it("normalizes SSH connection fields", () => {
		expect(
			normalizeRemoteEnvironmentProfile({
				id: " remote-1 ",
				name: " Build box ",
				host: " builder.example.com ",
				user: " ubuntu ",
				port: 2222,
				identityFile: " ~/.ssh/build ",
			}),
		).toEqual({
			id: "remote-1",
			name: "Build box",
			host: "builder.example.com",
			user: "ubuntu",
			port: 2222,
			identityFile: "~/.ssh/build",
		});
	});

	it("validates required connection fields and formats destinations", () => {
		const profile = {
			name: "Build box",
			host: "builder.example.com",
			user: "ubuntu",
			port: 2222,
		};
		expect(validateRemoteEnvironmentProfile(profile)).toBeUndefined();
		expect(formatRemoteEnvironmentDestination(profile)).toBe(
			"ubuntu@builder.example.com:2222",
		);
		expect(
			formatRemoteEnvironmentDestination({
				host: "build-alias",
				port: undefined,
			}),
		).toBe("build-alias");
	});
});
