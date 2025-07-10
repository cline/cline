// Tests for VERTEX_REGIONS "global" region handling

import { describe, it, expect } from "vitest"
import { VERTEX_REGIONS } from "../../../../../../packages/types/src/providers/vertex"

describe("VERTEX_REGIONS", () => {
	it('should include the "global" region as the first entry', () => {
		expect(VERTEX_REGIONS[0]).toEqual({ value: "global", label: "global" })
	})

	it('should contain "global" region exactly once', () => {
		const globalRegions = VERTEX_REGIONS.filter((r: { value: string; label: string }) => r.value === "global")
		expect(globalRegions).toHaveLength(1)
	})

	it('should contain all expected regions including "global"', () => {
		// The expected list is the imported VERTEX_REGIONS itself
		expect(VERTEX_REGIONS).toEqual([
			{ value: "global", label: "global" },
			{ value: "us-central1", label: "us-central1" },
			{ value: "us-east1", label: "us-east1" },
			{ value: "us-east4", label: "us-east4" },
			{ value: "us-east5", label: "us-east5" },
			{ value: "us-west1", label: "us-west1" },
			{ value: "us-west2", label: "us-west2" },
			{ value: "us-west3", label: "us-west3" },
			{ value: "us-west4", label: "us-west4" },
			{ value: "northamerica-northeast1", label: "northamerica-northeast1" },
			{ value: "northamerica-northeast2", label: "northamerica-northeast2" },
			{ value: "southamerica-east1", label: "southamerica-east1" },
			{ value: "europe-west1", label: "europe-west1" },
			{ value: "europe-west2", label: "europe-west2" },
			{ value: "europe-west3", label: "europe-west3" },
			{ value: "europe-west4", label: "europe-west4" },
			{ value: "europe-west6", label: "europe-west6" },
			{ value: "europe-central2", label: "europe-central2" },
			{ value: "asia-east1", label: "asia-east1" },
			{ value: "asia-east2", label: "asia-east2" },
			{ value: "asia-northeast1", label: "asia-northeast1" },
			{ value: "asia-northeast2", label: "asia-northeast2" },
			{ value: "asia-northeast3", label: "asia-northeast3" },
			{ value: "asia-south1", label: "asia-south1" },
			{ value: "asia-south2", label: "asia-south2" },
			{ value: "asia-southeast1", label: "asia-southeast1" },
			{ value: "asia-southeast2", label: "asia-southeast2" },
			{ value: "australia-southeast1", label: "australia-southeast1" },
			{ value: "australia-southeast2", label: "australia-southeast2" },
			{ value: "me-west1", label: "me-west1" },
			{ value: "me-central1", label: "me-central1" },
			{ value: "africa-south1", label: "africa-south1" },
		])
	})

	it('should contain "asia-east1" region exactly once', () => {
		const asiaEast1Regions = VERTEX_REGIONS.filter(
			(r: { value: string; label: string }) => r.value === "asia-east1" && r.label === "asia-east1",
		)
		expect(asiaEast1Regions).toHaveLength(1)
		expect(asiaEast1Regions[0]).toEqual({ value: "asia-east1", label: "asia-east1" })
	})
})
