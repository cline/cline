# Aihubmix 集成指南

## 概述

Cline 现在支持通过 aihubmix 统一网关访问多个 AI 模型提供商。aihubmix 提供了统一的 API 接口，支持 Anthropic、OpenAI、Google Gemini 等主流模型。

## 功能特性

- **统一网关**: 通过单一 API 访问多个模型提供商
- **智能路由**: 根据模型名称自动路由到对应的 SDK
- **折扣支持**: 内置 APP-Code 享受 aihubmix 折扣
- **空工具修复**: 自动处理空工具数组的 tool_choice 问题
- **多模型支持**: 支持 Claude、GPT、Gemini 等主流模型

## 配置方法

### 1. 获取 API 密钥

1. 访问 [aihubmix.com](https://aihubmix.com)
2. 注册账户并获取 API 密钥
3. 在 Cline 设置中配置 API 密钥

### 2. 在 Cline 中配置

1. 打开 Cline 设置
2. 选择 "API Providers"
3. 选择 "Aihubmix"
4. 输入你的 aihubmix API 密钥
5. 选择要使用的模型

## 支持的模型

### Claude 模型 (通过 Anthropic SDK)
- `claude-3-5-sonnet-20241022`
- `claude-3-5-haiku-20241022`
- `claude-3-opus-20240229`

### GPT 模型 (通过 OpenAI 兼容接口)
- `gpt-4o-mini`
- `gpt-4o`
- `gpt-4-turbo`
- `gpt-3.5-turbo`

### Gemini 模型 (通过 Google SDK)
- `gemini-2.0-flash-exp`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

## 使用示例

### 基本配置

```typescript
// 在 Cline 配置中设置
const config = {
  apiProvider: "aihubmix",
  aihubmixApiKey: "your-aihubmix-api-key",
  aihubmixBaseUrl: "https://aihubmix.com", // 可选，默认为此值
  aihubmixAppCode: "WHVL9885", // 可选，默认为此值
  apiModelId: "gpt-4o-mini" // 或任何支持的模型
}
```

### 模型路由示例

```typescript
// Claude 模型会自动路由到 Anthropic SDK
const claudeResponse = await cline.chat("claude-3-5-sonnet-20241022", "Hello!")

// GPT 模型会路由到 OpenAI 兼容接口
const gptResponse = await cline.chat("gpt-4o-mini", "Hello!")

// Gemini 模型会路由到 Google SDK
const geminiResponse = await cline.chat("gemini-2.0-flash-exp", "Hello!")
```

## 高级功能

### 1. 自定义配置

```typescript
const customConfig = {
  apiProvider: "aihubmix",
  aihubmixApiKey: "your-key",
  aihubmixBaseUrl: "https://your-custom-endpoint.com",
  aihubmixAppCode: "YOUR_CUSTOM_CODE"
}
```

### 2. 工具调用支持

aihubmix 提供商支持工具调用，包括：
- 函数调用
- 工具选择
- 自动工具修复

### 3. 流式响应

支持实时流式响应，提供更好的用户体验。

## 故障排除

### 常见问题

1. **API 密钥错误**
   - 确保 API 密钥正确
   - 检查密钥是否有效

2. **模型不支持**
   - 确认模型名称正确
   - 检查模型是否在支持列表中

3. **网络连接问题**
   - 检查网络连接
   - 确认 aihubmix 服务可用

### 调试模式

启用调试模式查看详细的 API 调用信息：

```typescript
const debugConfig = {
  apiProvider: "aihubmix",
  aihubmixApiKey: "your-key",
  // 启用调试日志
  debug: true
}
```

## 价格和限制

- 价格基于 aihubmix 的定价
- 享受内置 APP-Code 折扣
- 支持所有 aihubmix 支持的模型
- 遵循 aihubmix 的使用限制

## 更新日志

### v1.0.0
- 初始 aihubmix 集成
- 支持 Claude、GPT、Gemini 模型
- 智能路由功能
- 折扣支持

## 技术支持

如有问题，请：
1. 查看 [aihubmix 文档](https://aihubmix.com/docs)
2. 联系 Cline 支持团队
3. 在 GitHub 上提交问题
