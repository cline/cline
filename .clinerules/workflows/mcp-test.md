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
调用 MCP 服务处理上传的矩阵文件并获取可访问的文件 内容的base64 编码字符串。

<use_mcp_tool>
<server_name>
can-tools
</server_name>
<tool_name>
handle_matrix_file
</tool_name>
<arguments>
{
  "fileUrl": "$(echo "$TASK_FILES" | grep "matrix_file_path" | cut -d'=' -f2-)"
}
</arguments>
</use_mcp_tool>


## 步骤 2: 任务完成
通知用户任务已完成,并输出上一步输出的处理结果。
<attempt_completion>

<result>
  直接输出上一步Mcp 的响应内容

</result>

</attempt_completion>