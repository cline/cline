import { describe, expect, it } from "vitest"
import { HtmlPreviewServiceClient } from "../grpc-client"

describe("HtmlPreviewServiceClient", () => {
	it("exposes HTML preview gRPC methods including Python kernel RPCs", () => {
		expect(HtmlPreviewServiceClient.runArtifactCode).toBeTypeOf("function")
		expect(HtmlPreviewServiceClient.listPythonEnvironments).toBeTypeOf("function")
		expect(HtmlPreviewServiceClient.setArtifactKernelProfile).toBeTypeOf("function")
		expect(HtmlPreviewServiceClient.probePythonEnvironment).toBeTypeOf("function")
		expect(HtmlPreviewServiceClient.getArtifactKernelInfo).toBeTypeOf("function")
		expect(HtmlPreviewServiceClient.interruptArtifactKernel).toBeTypeOf("function")
		expect(HtmlPreviewServiceClient.restartArtifactKernel).toBeTypeOf("function")
	})
})
