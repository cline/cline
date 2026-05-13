import "should"
import {
	addNvidiaBillingOriginHeader,
	addNvidiaBillingOriginHeaderForBaseUrl,
	NVIDIA_NIM_BILLING_ORIGIN_HEADER,
	NVIDIA_NIM_BILLING_ORIGIN_VALUE,
	isPublicNvidiaNimBaseUrl,
} from "../net"

describe("NVIDIA NIM billing origin headers", () => {
	it("detects the public NVIDIA NIM host", () => {
		isPublicNvidiaNimBaseUrl("https://integrate.api.nvidia.com/v1").should.equal(true)
		isPublicNvidiaNimBaseUrl("https://proxy.example.com/v1").should.equal(false)
		isPublicNvidiaNimBaseUrl("not a url").should.equal(false)
	})

	it("adds the billing origin header without dropping existing headers", () => {
		addNvidiaBillingOriginHeader({ Authorization: "Bearer test" }).should.deepEqual({
			Authorization: "Bearer test",
			[NVIDIA_NIM_BILLING_ORIGIN_HEADER]: NVIDIA_NIM_BILLING_ORIGIN_VALUE,
		})
	})

	it("does not overwrite an explicitly provided origin header", () => {
		addNvidiaBillingOriginHeader({
			"x-billing-invoke-origin": "CustomOrigin",
		}).should.deepEqual({
			"x-billing-invoke-origin": "CustomOrigin",
		})
	})

	it("only adds the header when the base URL is public NVIDIA NIM", () => {
		addNvidiaBillingOriginHeaderForBaseUrl("https://integrate.api.nvidia.com/v1", {
			"X-Test": "1",
		}).should.deepEqual({
			"X-Test": "1",
			[NVIDIA_NIM_BILLING_ORIGIN_HEADER]: NVIDIA_NIM_BILLING_ORIGIN_VALUE,
		})

		addNvidiaBillingOriginHeaderForBaseUrl("https://proxy.example.com/v1", {
			"X-Test": "1",
		}).should.deepEqual({ "X-Test": "1" })
	})
})
