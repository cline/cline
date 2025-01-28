import { describe, it } from "mocha"
import "should"
import { getShell } from "./shell"

describe("Shell Utilities", () => {
  describe("getShell", () => {
    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = process.platform
      Object.defineProperty(process, "platform", {
        value: "darwin"
      })
    })

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform
      })
    })

    it("should return defaultShell on non-Windows platforms", async () => {
      const shell = await getShell()
      shell.should.be.a.String()
    })
  })
})
