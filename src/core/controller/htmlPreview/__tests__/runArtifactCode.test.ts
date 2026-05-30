import { ArtifactCodeLanguage, RunArtifactCodeRequest } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import * as sinon from "sinon"
import type { Controller } from "../.."
import * as approval from "../ensurePythonExecutionAllowed"
import { runArtifactCode } from "../runArtifactCode"

describe("runArtifactCode", () => {
	let mockController: Partial<Controller>
	let executeStub: sinon.SinonStub
	let allowStub: sinon.SinonStub

	beforeEach(() => {
		executeStub = sinon.stub().resolves({
			stdout: "hi\n",
			stderr: "",
			status: "ok",
			error: "",
			resultRepr: "",
			imagesPngBase64: [],
			videosMp4Base64: [],
			truncated: false,
		})
		allowStub = sinon.stub(approval, "ensurePythonExecutionAllowed").resolves(true)

		mockController = {
			context: {} as Controller["context"],
			getArtifactPreviewService: (() => ({
				get: () => ({
					id: "artifact_1",
					dirFsPath: "/tmp",
				}),
			})) as unknown as Controller["getArtifactPreviewService"],
			getArtifactKernelService: (() => ({
				execute: executeStub,
				getInfoOrDefault: sinon.stub().resolves({
					executionCount: 1,
					kernelDirty: true,
				}),
			})) as unknown as Controller["getArtifactKernelService"],
		}
	})

	afterEach(() => {
		sinon.restore()
	})

	it("returns denied when approval fails", async () => {
		allowStub.resolves(false)
		const result = await runArtifactCode(
			mockController as Controller,
			RunArtifactCodeRequest.create({
				artifactId: "artifact_1",
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print(1)",
			}),
		)
		expect(result.status).to.equal("denied")
		expect(executeStub.called).to.be.false
	})

	it("executes python when approved", async () => {
		const result = await runArtifactCode(
			mockController as Controller,
			RunArtifactCodeRequest.create({
				artifactId: "artifact_1",
				profileId: "profile_abc",
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print('hi')",
				cellId: "cell-1",
			}),
		)
		expect(result.status).to.equal("success")
		expect(result.stdout).to.equal("hi\n")
		expect(executeStub.calledOnce).to.be.true
		expect(executeStub.firstCall.args[0]).to.equal("print('hi')")
		expect(executeStub.firstCall.args[1]).to.equal("artifact_1")
		expect(executeStub.firstCall.args[2]).to.equal("profile_abc")
		expect(executeStub.firstCall.args[4]).to.equal("cell-1")
	})

	it("requires artifact_id", async () => {
		const result = await runArtifactCode(
			mockController as Controller,
			RunArtifactCodeRequest.create({
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print(1)",
			}),
		)
		expect(result.status).to.equal("error")
		expect(executeStub.called).to.be.false
	})
})
