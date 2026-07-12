import { expect } from "chai"
import { describe, it } from "mocha"
import type { RunArtifactCodeResult } from "../ArtifactKernelService"
import { mapRunResultToOutputs } from "../mapRunResultToOutputs"

const BASE: RunArtifactCodeResult = {
	stdout: "",
	stderr: "",
	status: "ok",
	error: "",
	resultRepr: "",
	imagesPngBase64: [],
	videosMp4Base64: [],
	truncated: false,
}

describe("mapRunResultToOutputs", () => {
	it("maps stdout, stderr, error and result representation to typed outputs", () => {
		const outputs = mapRunResultToOutputs({
			...BASE,
			stdout: "hi",
			stderr: "warn",
			error: "boom",
			resultRepr: "42",
		})
		const byType = outputs.map((o) => o.type)
		expect(byType).to.include.members(["stdout", "stderr", "error", "result"])
	})

	it("maps PNG images to image/png outputs", () => {
		const outputs = mapRunResultToOutputs({ ...BASE, imagesPngBase64: ["AAAA"] })
		const img = outputs.find((o) => o.type === "image/png")
		expect(img?.data).to.equal("AAAA")
	})

	it("maps rendered MP4 videos to video/mp4 outputs", () => {
		const outputs = mapRunResultToOutputs({ ...BASE, videosMp4Base64: ["BBBB", "CCCC"] })
		const videos = outputs.filter((o) => o.type === "video/mp4")
		expect(videos.map((v) => v.data)).to.deep.equal(["BBBB", "CCCC"])
	})

	it("tolerates a result missing the videos field", () => {
		const result = { ...BASE } as RunArtifactCodeResult
		delete (result as { videosMp4Base64?: string[] }).videosMp4Base64
		const outputs = mapRunResultToOutputs(result)
		expect(outputs.some((o) => o.type === "video/mp4")).to.equal(false)
	})
})
