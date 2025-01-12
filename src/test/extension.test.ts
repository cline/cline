import { readFile } from "fs/promises"
import { describe, it, after } from "mocha"
import path from "path"
import "should"
import * as vscode from "vscode"
import { DashboardHandler } from "../api/providers/dashboard"
import { CoffeePlotHandler } from "../api/providers/coffeePlot"
import { FinanceHandler } from "../api/providers/finance"
import { InventoryHandler } from "../api/providers/inventory"
import { QualityControlHandler } from "../api/providers/qualityControl"
import { TraceabilityHandler } from "../api/providers/traceability"
import { MachineryHandler } from "../api/providers/machinery"
import { ReportHandler } from "../api/providers/report"

const packagePath = path.join(__dirname, "..", "..", "..", "package.json")

describe("Cline Extension", () => {
	after(() => {
		vscode.window.showInformationMessage("All tests done!")
	})

	it("should verify extension ID matches package.json", async () => {
		const packageJSON = JSON.parse(await readFile(packagePath, "utf8"))
		const id = packageJSON.publisher + "." + packageJSON.name
		const clineExtensionApi = vscode.extensions.getExtension(id)

		clineExtensionApi?.id.should.equal(id)
	})

	it("should successfully execute the plus button command", async () => {
		await new Promise((resolve) => setTimeout(resolve, 400))
		await vscode.commands.executeCommand("cline.plusButtonClicked")
	})

	it("should create and use DashboardHandler", async () => {
		const handler = new DashboardHandler({ apiKey: "test-key" })
		await handler.renderView()
		await handler.fetchData()
	})

	it("should create and use CoffeePlotHandler", async () => {
		const handler = new CoffeePlotHandler({ apiKey: "test-key" })
		await handler.analyzeSoil()
		await handler.registerActivity()
		await handler.analyzeLeaf()
		await handler.analyzePest()
	})

	it("should create and use FinanceHandler", async () => {
		const handler = new FinanceHandler({ apiKey: "test-key" })
		await handler.createTransaction()
		await handler.generateCashFlow()
		await handler.manageFutureSale()
	})

	it("should create and use InventoryHandler", async () => {
		const handler = new InventoryHandler({ apiKey: "test-key" })
		await handler.addToInventory()
		await handler.removeFromInventory()
		await handler.calculateProductValue()
		await handler.checkProductAvailability()
	})

	it("should create and use QualityControlHandler", async () => {
		const handler = new QualityControlHandler({ apiKey: "test-key" })
		await handler.assessQuality()
		await handler.finalizeReport()
	})

	it("should create and use TraceabilityHandler", async () => {
		const handler = new TraceabilityHandler({ apiKey: "test-key" })
		await handler.traceLot()
		await handler.generateAudit()
	})

	it("should create and use MachineryHandler", async () => {
		const handler = new MachineryHandler({ apiKey: "test-key" })
		await handler.scheduleMaintenance()
		await handler.updateStatus()
	})

	it("should create and use ReportHandler", async () => {
		const handler = new ReportHandler({ apiKey: "test-key" })
		await handler.generateReport()
		await handler.exportToFormat()
	})
})
