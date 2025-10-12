/**
 * Aihubmix 提供商使用示例
 *
 * 这个示例展示了如何在 Cline 中使用 aihubmix 统一网关
 */

import { AihubmixHandler } from "../src/core/api/providers/aihubmix"

// 基本使用示例
async function basicUsage() {
	// 创建 aihubmix 处理器
	const handler = new AihubmixHandler({
		apiKey: "your-aihubmix-api-key",
		baseUrl: "https://aihubmix.com",
		appCode: "WHVL9885", // 享受折扣
		modelId: "gpt-4o-mini",
	})

	// 发送消息
	const messages = [
		{
			role: "user" as const,
			content: "你好，请介绍一下你自己",
		},
	]

	console.log("发送消息到 aihubmix...")

	// 流式响应
	for await (const chunk of handler.createMessage("你是一个有用的AI助手", messages)) {
		if (chunk.type === "text") {
			process.stdout.write(chunk.text)
		}
	}

	console.log("\n\n消息完成！")
}

// 模型路由示例
function demonstrateModelRouting() {
	const handler = new AihubmixHandler({
		apiKey: "your-aihubmix-api-key",
	})

	// 测试不同模型的路由
	const models = [
		"claude-3-5-sonnet-20241022", // 路由到 Anthropic
		"gpt-4o-mini", // 路由到 OpenAI
		"gpt-4o", // 路由到 OpenAI
		"gemini-2.0-flash-exp", // 路由到 OpenAI (因为移除了 Gemini 支持)
	]

	models.forEach((model) => {
		const route = (handler as any).routeModel(model)
		console.log(`模型 ${model} 路由到: ${route}`)
	})
}

// 工具调用示例
async function toolCallExample() {
	const handler = new AihubmixHandler({
		apiKey: "your-aihubmix-api-key",
		modelId: "gpt-4o-mini",
	})

	// 模拟工具调用请求
	const requestBody = {
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: "请帮我计算 2+2" }],
		tools: [], // 空工具数组
		tool_choice: "auto", // 这会被自动移除
	}

	// 应用空工具修复
	const fixedRequestBody = (handler as any).fixToolChoice(requestBody)

	console.log("原始请求体:", JSON.stringify(requestBody, null, 2))
	console.log("修复后请求体:", JSON.stringify(fixedRequestBody, null, 2))
}

// 错误处理示例
async function errorHandlingExample() {
	const handler = new AihubmixHandler({
		apiKey: "invalid-key", // 无效的 API 密钥
		modelId: "gpt-4o-mini",
	})

	try {
		const messages = [{ role: "user" as const, content: "测试错误处理" }]

		for await (const _chunk of handler.createMessage("", messages)) {
			// 处理响应
		}
	} catch (error) {
		console.error("捕获到错误:", error.message)
	}
}

// 运行示例
async function runExamples() {
	console.log("=== Aihubmix 提供商使用示例 ===\n")

	console.log("1. 模型路由演示:")
	demonstrateModelRouting()

	console.log("\n2. 工具调用修复演示:")
	await toolCallExample()

	console.log("\n3. 错误处理演示:")
	await errorHandlingExample()

	console.log("\n4. 基本使用演示 (需要有效的 API 密钥):")
	// await basicUsage() // 取消注释以运行实际测试
}

// 如果直接运行此文件
if (require.main === module) {
	runExamples().catch(console.error)
}

export { basicUsage, demonstrateModelRouting, toolCallExample, errorHandlingExample }
