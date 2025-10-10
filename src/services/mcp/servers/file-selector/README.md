# File Selector MCP Server

这是一个用于在VS Code中选择文件的MCP服务器。它提供了一个`select_file`工具，可以打开VS Code的文件选择对话框并返回选中的文件路径。

## 功能

- 打开VS Code文件选择对话框
- 支持选择单个或多个文件
- 支持选择文件夹
- 返回选中的文件路径

## 工具

### select_file

打开文件选择对话框并返回选中的文件路径。

**参数:**
- `canSelectMany` (boolean, 可选): 是否允许选择多个文件，默认为false
- `canSelectFolders` (boolean, 可选): 是否允许选择文件夹，默认为false
- `canSelectFiles` (boolean, 可选): 是否允许选择文件，默认为true
- `title` (string, 可选): 对话框标题

**返回:**
```json
{
  "filePath": "/path/to/selected/file",
  "canceled": false
}
```

如果用户取消选择:
```json
{
  "canceled": true
}
```

## 部署

MCP服务器会在Cline启动时自动注册并启用。

## 使用示例

在Cline中可以通过以下方式调用:

```xml
<use_mcp_tool>
<server_name>file-selector</server_name>
<tool_name>select_file</tool_name>
<arguments>
{
  "title": "选择一个文件",
  "canSelectFiles": true,
  "canSelectFolders": false
}
</arguments>
</use_mcp_tool>
```