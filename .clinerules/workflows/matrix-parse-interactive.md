# 矩阵解析交互式工作流

## 目标
处理 CAN 矩阵文件并将其转换为 DBC 格式，每一步都与用户进行交互，然后根据用户偏好生成 C/Java 代码。

## 交互指南
- 在每一步中，使用适当的 Cline 工具展示结果并请求用户确认
- 如果用户提供反馈，将其纳入下一步处理
- 仅在整個過程完成並獲得用戶批准時才使用 attempt_completion
- 优雅地处理错误并提供清晰的错误消息
- 在整个工作流中保持上下文以确保一致的用户体验

## 技術实现说明
- 使用 use_mcp_tool 调用各种 MCP 服务处理文件
- 必要时将文件内容作为 base64 编码字符串处理
- 验证所有用户输入和文件格式
- 在每个阶段提供清晰的进度指示器
- 支持从任何步骤恢复

## 上下文传递说明
- 文件路径通过任务系统上下文传递，使用 TASK_FILES 环境变量
- MCP 工具处理后返回结果，供后续步骤使用
- 后续步骤可以通过解析 TASK_FILES 获取原始文件路径或使用 MCP 工具返回的结果

## 步骤 1: 文件处理
调用 MCP 服务处理上传的矩阵文件并获取可访问的文件 URL。

<use_mcp_tool>
<server_name>
Matrix File Processor
</server_name>
<tool_name>
process_matrix_file
</tool_name>
<arguments>
{
  "fileUrl": "$(echo "$TASK_FILES" | grep "matrix_file_path" | cut -d'=' -f2-)"
}
</arguments>
</use_mcp_tool>

## 步骤 2: DBC 转换
使用 MCP 服务将上传的 Excel 矩阵文件转换为 DBC 格式。
- 通过 LLM 处理矩阵文件内容生成标准 DBC 格式
- 向用户展示转换后的 DBC 内容以供审核
- 请求用户确认转换结果

<use_mcp_tool>
<server_name>
Matrix Parser MCP Server
</server_name>
<tool_name>
convert_matrix_to_dbc
</tool_name>
<arguments>
{
  "file_url": "{MCP_TOOL_RESULT}"
}
</arguments>
</use_mcp_tool>

## 步骤 3: DBC 验证
验证生成的 DBC 文件的正确性和合规性。
- 检查 DBC 语法和结构
- 验证所有必需字段是否存在
- 识别潜在的问题或不一致之处
- 向用户展示验证结果

<use_mcp_tool>
<server_name>
DBC Validator MCP Server
</server_name>
<tool_name>
validate_dbc_file
</tool_name>
<arguments>
{
  "dbc_content": "{MCP_TOOL_RESULT}"
}
</arguments>
</use_mcp_tool>

## 步骤 4: 代码生成选项
询问用户偏好的代码生成编程语言。
- 提供 C 和 Java 代码生成选项
- 等待用户选择后再继续

<ask>
<type>
confirm_code_generation
</type>
<options>
["c", "java"]
</options>
</ask>

## 步骤 5: 代码生成
根据用户选择的语言偏好从验证的 DBC 文件生成代码。
- 对于 C 语言：生成包含适当结构和函数的 .h 和 .c 文件
- 对于 Java 语言：生成具有正确面向对象设计的 Java 类
- 遵循特定语言的编码标准和最佳实践

<use_mcp_tool>
<server_name>
Code Generator MCP Server
</server_name>
<tool_name>
generate_code_from_dbc
</tool_name>
<arguments>
{
  "dbc_content": "{MCP_TOOL_RESULT}",
  "language": "{USER_SELECTED_LANGUAGE}"
}
</arguments>
</use_mcp_tool>

## 步骤 6: 代码验证
验证生成代码的语法正确性和质量。
- 检查语法错误
- 验证代码是否遵循语言标准
- 确保生成的代码可编译
- 向用户展示验证结果

<use_mcp_tool>
<server_name>
Code Validator MCP Server
</server_name>
<tool_name>
validate_generated_code
</tool_name>
<arguments>
{
  "code_content": "{MCP_TOOL_RESULT}",
  "language": "{USER_SELECTED_LANGUAGE}"
}
</arguments>
</use_mcp_tool>

## 步骤 7: 任务完成
通知用户任务已完成并提供下载选项。
- 提供下载 DBC 文件和生成代码的选项
- 提供整个过程的摘要
- 询问用户是否需要其他帮助

<attempt_completion>
<message>
矩阵解析任务已完成。DBC 文件和生成的代码已准备就绪，可以通过以下路径访问：
- DBC 文件: /tmp/generated.dbc
- 代码文件: /tmp/generated_code.{USER_SELECTED_LANGUAGE}

如果需要进一步的帮助或有其他任务，请随时告诉我.
</message>
<filesystem_outputs>
["/tmp/generated.dbc", "/tmp/generated_code.{USER_SELECTED_LANGUAGE}"]
</filesystem_outputs>
</attempt_completion>

