import { describe, expect, it } from "vitest";
import {
	addNvidiaBillingOriginHeader,
	addNvidiaBillingOriginHeaderForBaseUrl,
	isPublicNvidiaNimBaseUrl,
	NVIDIA_NIM_BILLING_ORIGIN_HEADER,
	NVIDIA_NIM_BILLING_ORIGIN_VALUE,
} from "./requests";

describe("NVIDIA NIM billing origin headers", () => {
	it("detects the public NVIDIA NIM host", () => {
		expect(
			isPublicNvidiaNimBaseUrl("https://integrate.api.nvidia.com/v1"),
		).toBe(true);
		expect(
			isPublicNvidiaNimBaseUrl(
				"https://integrate.api.nvidia.com/v1/chat/completions",
			),
		).toBe(true);
		expect(isPublicNvidiaNimBaseUrl("https://proxy.example.com/v1")).toBe(
			false,
		);
		expect(isPublicNvidiaNimBaseUrl("not a url")).toBe(false);
	});

	it("adds the billing origin header without dropping existing headers", () => {
		expect(
			addNvidiaBillingOriginHeader({ Authorization: "Bearer test" }),
		).toEqual({
			Authorization: "Bearer test",
			[NVIDIA_NIM_BILLING_ORIGIN_HEADER]: NVIDIA_NIM_BILLING_ORIGIN_VALUE,
		});
	});

	it("does not overwrite an explicitly provided origin header", () => {
		expect(
			addNvidiaBillingOriginHeader({
				"x-billing-invoke-origin": "CustomOrigin",
			}),
		).toEqual({
			"x-billing-invoke-origin": "CustomOrigin",
		});
	});

	it("only adds the header when the base URL is public NVIDIA NIM", () => {
		expect(
			addNvidiaBillingOriginHeaderForBaseUrl(
				"https://integrate.api.nvidia.com/v1",
				{ "X-Test": "1" },
			),
		).toEqual({
			"X-Test": "1",
			[NVIDIA_NIM_BILLING_ORIGIN_HEADER]: NVIDIA_NIM_BILLING_ORIGIN_VALUE,
		});

		expect(
			addNvidiaBillingOriginHeaderForBaseUrl("https://proxy.example.com/v1", {
				"X-Test": "1",
			}),
		).toEqual({ "X-Test": "1" });
	});
});
