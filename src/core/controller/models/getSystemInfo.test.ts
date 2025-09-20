import { EmptyRequest } from "@shared/proto/cline/common"
import { expect } from "chai"
import { describe, it } from "mocha"
import * as os from "os"
import { getSystemInfo } from "./getSystemInfo"

describe("getSystemInfo", () => {
	it("should return system information", async () => {
		// 创建一个模拟的 controller 对象
		const mockController: any = {}

		// 创建空请求
		const request = EmptyRequest.create({})

		// 调用函数
		const result = await getSystemInfo(mockController, request)

		// 验证返回的结果
		expect(result).to.not.be.null
		expect(result.platform).to.equal(process.platform)
		expect(result.arch).to.equal(process.arch)
		expect(result.totalMemory).to.equal(os.totalmem())
		expect(result.freeMemory).to.equal(os.freemem())
		expect(result.cpuCount).to.equal(os.cpus().length)
		expect(result.hostname).to.equal(os.hostname())
		expect(result.uptime).to.equal(os.uptime())
	})

	it("should handle empty request", async () => {
		const mockController: any = {}
		const request = EmptyRequest.create()

		const result = await getSystemInfo(mockController, request)

		expect(result).to.not.be.null
		expect(result.platform).to.be.a("string")
		expect(result.arch).to.be.a("string")
		expect(result.hostname).to.be.a("string")
		expect(result.totalMemory).to.be.a("number")
		expect(result.freeMemory).to.be.a("number")
		expect(result.cpuCount).to.be.a("number")
		expect(result.uptime).to.be.a("number")
	})
})
