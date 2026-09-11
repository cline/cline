import { describe, expect, it } from "vitest";
import {
	buildOrganizationConfigOption,
	PERSONAL_ACCOUNT_VALUE,
} from "./organizations";

describe("buildOrganizationConfigOption", () => {
	const organizations = [
		{
			active: false,
			memberId: "m-1",
			name: "Acme Corp",
			organizationId: "org-1",
			roles: ["member" as const],
		},
		{
			active: true,
			memberId: "m-2",
			name: "Cline Bot Inc",
			organizationId: "org-2",
			roles: ["admin" as const],
		},
	];

	it("lists Personal first plus every organization", () => {
		const option = buildOrganizationConfigOption({
			organizations,
			activeOrganizationId: "org-2",
		});
		expect(option.id).toBe("organization");
		if (option.type !== "select") {
			throw new Error(`expected a select option, got ${option.type}`);
		}
		expect(option.currentValue).toBe("org-2");
		expect(option.options).toEqual([
			{ value: PERSONAL_ACCOUNT_VALUE, name: "Personal" },
			{ value: "org-1", name: "Acme Corp" },
			{ value: "org-2", name: "Cline Bot Inc" },
		]);
	});

	it("selects Personal when no organization is active", () => {
		const option = buildOrganizationConfigOption({
			organizations,
			activeOrganizationId: null,
		});
		expect(option.currentValue).toBe(PERSONAL_ACCOUNT_VALUE);
	});
});
