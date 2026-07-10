import { expect } from "chai"
import { describe, it } from "mocha"
import { scrubKernelEnv } from "../scrubKernelEnv"

describe("scrubKernelEnv", () => {
	it("drops secret-shaped vars", () => {
		const input = {
			OPENAI_API_KEY: "sk-abc",
			AWS_SECRET_ACCESS_KEY: "xyz",
			HF_TOKEN: "hf_abc",
			AWS_ACCESS_KEY_ID: "AKIA...",
			GITHUB_TOKEN: "ghp_abc",
			DB_PASSWORD: "hunter2",
			EARTHENGINE_TOKEN: "abc",
			GOOGLE_APPLICATION_CREDENTIALS: "/path/to/creds.json",
			ANTHROPIC_API_KEY: "sk-ant",
		}
		const scrubbed = scrubKernelEnv(input)
		expect(Object.keys(scrubbed)).to.have.length(0)
	})

	it("preserves legitimate vars needed by real workflows", () => {
		const input = {
			PATH: "/usr/bin:/bin",
			HOME: "/Users/researcher",
			LANG: "en_US.UTF-8",
			PYTHONPATH: "/opt/pkgs",
			CONDA_PREFIX: "/opt/miniconda3",
			VIRTUAL_ENV: "/workspace/.venv",
			TMPDIR: "/tmp",
		}
		const scrubbed = scrubKernelEnv(input)
		expect(scrubbed).to.deep.equal(input)
	})

	it("regression: a script using GEE auth files under $HOME still has HOME available", () => {
		// GEE authenticates via a credentials FILE under $HOME, not an env var —
		// scrubbing must not remove HOME itself, only env-carried secrets.
		const scrubbed = scrubKernelEnv({ HOME: "/Users/researcher", EARTHENGINE_TOKEN: "leak" })
		expect(scrubbed.HOME).to.equal("/Users/researcher")
		expect(scrubbed.EARTHENGINE_TOKEN).to.be.undefined
	})
})
