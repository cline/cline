# VS Code Host Bridge API

<cite>
**本文档中引用的文件**
- [openDiff.ts](file://src/hosts/vscode/hostbridge/diff/openDiff.ts)
- [replaceText.ts](file://src/hosts/vscode/hostbridge/diff/replaceText.ts)
- [scrollDiff.ts](file://src/hosts/vscode/hostbridge/diff/scrollDiff.ts)
- [clipboardReadText.ts](file://src/hosts/vscode/hostbridge/env/clipboardReadText.ts)
- [clipboardWriteText.ts](file://src/hosts/vscode/hostbridge/env/clipboardWriteText.ts)
- [getHostVersion.ts](file://src/hosts/vscode/hostbridge/env/getHostVersion.ts)
- [getActiveEditor.ts](file://src/hosts/vscode/hostbridge/window/getActiveEditor.ts)
- [openFile.ts](file://src/hosts/vscode/hostbridge/window/openFile.ts)
- [showInputBox.ts](file://src/hosts/vscode/hostbridge/window/showInputBox.ts)
- [showMessage.ts](file://src/hosts/vscode/hostbridge/window/showMessage.ts)
- [getWorkspacePaths.ts](file://src/hosts/vscode/hostbridge/workspace/getWorkspacePaths.ts)
- [getDiagnostics.ts](file://src/hosts/vscode/hostbridge/workspace/getDiagnostics.ts)
- [openClineSidebarPanel.ts](file://src/hosts/vscode/hostbridge/workspace/openClineSidebarPanel.ts)
- [host-provider.ts](file://src/hosts/host-provider.ts)
</cite>

## 目录
1. [简介](#简介)
2. [diff模块](#diff模块)
3. [env模块](#env模块)
4. [window模块](#window模块)
5. [workspace模块](#workspace模块)

## 简介
VS Code Host Bridge API是cline扩展与VS Code IDE进行交互的核心桥梁。该API通过gRPC服务提供了一组标准化的方法，使cline扩展能够访问和控制VS Code的各种功能。API被组织在`src/hosts/vscode/hostbridge/`目录下的不同模块中，每个模块负责特定的功能领域。通过`HostProvider`静态类，cline核心组件可以方便地访问这些服务客户端。

**Section sources**
- [host-provider.ts](file://src/hosts/host-provider.ts#L54-L108)

## diff模块
diff模块提供了与VS Code差异视图交互的功能。然而，根据代码实现，该模块的大多数功能目前不被支持，建议使用`VscodeDiffViewProvider`来处理差异视图操作。

### 打开差异视图
`openDiff`方法用于在VS Code中打开差异视图，比较两个文件的差异。此方法接收一个包含原始文件路径和修改后文件路径的请求对象。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { OpenDiffRequest } from "@/shared/proto/index.host"

const request = OpenDiffRequest.create({
  originalFilePath: "/path/to/original/file.ts",
  modifiedFilePath: "/path/to/modified/file.ts",
  title: "文件差异"
})

try {
  const response = await HostProvider.window.openDiff(request)
  console.log("差异视图已打开:", response.diff_id)
} catch (error) {
  console.error("无法打开差异视图:", error)
}
```

在cline工作流中，当AI代理生成代码修改建议时，可以使用此API将原始文件和修改后的文件并排显示，让用户直观地查看变更内容。

**Section sources**
- [openDiff.ts](file://src/hosts/vscode/hostbridge/diff/openDiff.ts#L1-L6)

### 替换文本
`replaceText`方法用于在编辑器中替换指定范围的文本。此方法接收一个包含文件路径、起始位置、结束位置和新文本的请求对象。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { ReplaceTextRequest } from "@/shared/proto/index.host"

const request = ReplaceTextRequest.create({
  filePath: "/path/to/file.ts",
  start: { line: 10, character: 5 },
  end: { line: 10, character: 15 },
  newText: "replacementText"
})

try {
  await HostProvider.diff.replaceText(request)
  console.log("文本已替换")
} catch (error) {
  console.error("文本替换失败:", error)
}
```

在AI代码生成场景中，当代理需要精确修改代码的特定部分时，此功能非常有用，可以确保只更改必要的代码行。

**Section sources**
- [replaceText.ts](file://src/hosts/vscode/hostbridge/diff/replaceText.ts#L1-L6)

### 滚动差异
`scrollDiff`方法用于在差异视图中滚动到指定的行。此方法接收一个包含目标行号的请求对象。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { ScrollDiffRequest } from "@/shared/proto/index.host"

const request = ScrollDiffRequest.create({
  line: 42
})

try {
  await HostProvider.diff.scrollDiff(request)
  console.log("已滚动到指定行")
} catch (error) {
  console.error("滚动失败:", error)
}
```

当AI代理检测到代码问题并希望引导用户关注特定代码行时，可以使用此功能自动滚动到相关位置，提高用户体验。

**Section sources**
- [scrollDiff.ts](file://src/hosts/vscode/hostbridge/diff/scrollDiff.ts#L1-L6)

## env模块
env模块提供了访问VS Code环境信息和系统功能的方法。

### 读取剪贴板
`clipboardReadText`方法用于从系统剪贴板读取文本内容。此方法不接收参数，返回剪贴板中的文本。

```typescript
import { HostProvider } from "@hosts/host-provider"

try {
  const response = await HostProvider.env.clipboardReadText()
  console.log("剪贴板内容:", response.value)
  // 在cline工作流中，可以将剪贴板内容作为上下文提供给AI模型
  const context = `用户从剪贴板复制了以下内容:\n${response.value}`
} catch (error) {
  console.error("读取剪贴板失败:", error)
}
```

在AI辅助编程中，此功能可用于获取用户复制的代码片段或文本，作为生成建议的上下文。

**Section sources**
- [clipboardReadText.ts](file://src/hosts/vscode/hostbridge/env/clipboardReadText.ts#L1-L8)

### 写入剪贴板
`clipboardWriteText`方法用于将文本写入系统剪贴板。此方法接收要写入的文本内容。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { StringRequest } from "@shared/proto/cline/common"

const request = StringRequest.create({
  value: "这是要复制到剪贴板的文本"
})

try {
  await HostProvider.env.clipboardWriteText(request)
  console.log("文本已复制到剪贴板")
} catch (error) {
  console.error("写入剪贴板失败:", error)
}
```

当AI代理生成代码建议或文档时，可以使用此功能将结果直接复制到剪贴板，方便用户粘贴使用。

**Section sources**
- [clipboardWriteText.ts](file://src/hosts/vscode/hostbridge/env/clipboardWriteText.ts#L1-L8)

### 获取主机版本
`getHostVersion`方法用于获取VS Code主机的版本信息。此方法返回包含平台名称和版本号的对象。

```typescript
import { HostProvider } from "@hosts/host-provider"

try {
  const response = await HostProvider.env.getHostVersion()
  console.log(`平台: ${response.platform}, 版本: ${response.version}`)
  
  // 在cline工作流中，可以根据VS Code版本提供兼容性检查
  if (response.platform === "VSCode" && response.version.startsWith("1.")) {
    console.log("当前VS Code版本受支持")
  }
} catch (error) {
  console.error("获取主机版本失败:", error)
}
```

此功能可用于确保cline扩展与当前VS Code版本兼容，或根据版本提供不同的功能支持。

**Section sources**
- [getHostVersion.ts](file://src/hosts/vscode/hostbridge/env/getHostVersion.ts#L1-L8)

## window模块
window模块提供了与VS Code窗口和编辑器交互的功能。

### 获取活动编辑器
`getActiveEditor`方法用于获取当前活动的编辑器文件路径。此方法返回活动编辑器的文件路径。

```typescript
import { HostProvider } from "@hosts/host-provider"

try {
  const response = await HostProvider.window.getActiveEditor()
  if (response.filePath) {
    console.log("当前活动文件:", response.filePath)
    // 在cline工作流中，可以基于当前文件提供上下文相关的AI建议
    const context = `用户正在编辑文件: ${response.filePath}`
  } else {
    console.log("没有活动的编辑器")
  }
} catch (error) {
  console.error("获取活动编辑器失败:", error)
}
```

此功能是AI代理理解用户当前工作上下文的关键，可以确保生成的建议与用户正在编辑的文件相关。

**Section sources**
- [getActiveEditor.ts](file://src/hosts/vscode/hostbridge/window/getActiveEditor.ts#L1-L9)

### 打开文件
`openFile`方法用于在VS Code中打开指定路径的文件。此方法接收文件路径作为参数。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { OpenFileRequest } from "@/shared/proto/host/window"

const request = OpenFileRequest.create({
  filePath: "/path/to/target/file.ts"
})

try {
  await HostProvider.window.openFile(request)
  console.log("文件已打开")
} catch (error) {
  console.error("打开文件失败:", error)
}
```

当AI代理需要引导用户查看特定文件时，例如在修复错误时查看相关代码文件，可以使用此功能自动打开文件。

**Section sources**
- [openFile.ts](file://src/hosts/vscode/hostbridge/window/openFile.ts#L1-L8)

### 显示输入框
`showInputBox`方法用于显示一个输入框，让用户输入文本。此方法可以配置标题、提示信息和默认值。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { ShowInputBoxRequest } from "@/shared/proto/index.host"

const request = ShowInputBoxRequest.create({
  title: "创建新文件",
  prompt: "请输入新文件的名称",
  value: "new-file.ts"
})

try {
  const response = await HostProvider.window.showInputBox(request)
  if (response.response) {
    console.log("用户输入:", response.response)
    // 基于用户输入执行后续操作
    await createNewFile(response.response)
  }
} catch (error) {
  console.error("显示输入框失败:", error)
}
```

在AI辅助开发中，此功能可用于收集用户输入，例如命名新生成的文件或配置AI建议的参数。

**Section sources**
- [showInputBox.ts](file://src/hosts/vscode/hostbridge/window/showInputBox.ts#L1-L12)

### 显示消息
`showMessage`方法用于显示不同类型的消息对话框（信息、警告、错误），并允许用户选择选项。此方法支持配置消息类型、详细信息和可选的操作按钮。

```typescript
import { HostProvider } from "@hosts/host-provider"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/index.host"

const request = ShowMessageRequest.create({
  type: ShowMessageType.INFORMATION,
  message: "代码生成完成",
  options: {
    detail: "AI代理已成功生成代码建议",
    items: ["查看建议", "应用更改", "取消"]
  }
})

try {
  const response = await HostProvider.window.showMessage(request)
  switch (response.selectedOption) {
    case "查看建议":
      await showDiffView()
      break
    case "应用更改":
      await applyCodeChanges()
      break
    default:
      console.log("操作已取消")
  }
} catch (error) {
  console.error("显示消息失败:", error)
}
```

此功能在AI工作流中非常重要，用于与用户交互，获取对AI生成建议的反馈和操作选择。

**Section sources**
- [showMessage.ts](file://src/hosts/vscode/hostbridge/window/showMessage.ts#L1-L27)

## workspace模块
workspace模块提供了访问工作区信息和状态的功能。

### 获取工作区路径
`getWorkspacePaths`方法用于获取当前VS Code工作区的所有根路径。此方法返回工作区文件夹的路径数组。

```typescript
import { HostProvider } from "@hosts/host-provider"

try {
  const response = await HostProvider.workspace.getWorkspacePaths()
  console.log("工作区路径:", response.paths)
  
  // 在cline工作流中，可以遍历所有工作区路径来搜索相关文件
  for (const path of response.paths) {
    const files = await searchFilesInPath(path, "*.ts")
    console.log(`在${path}中找到${files.length}个TypeScript文件`)
  }
} catch (error) {
  console.error("获取工作区路径失败:", error)
}
```

此功能是AI代理理解项目结构的基础，可以用于在项目中搜索相关文件或分析代码库。

**Section sources**
- [getWorkspacePaths.ts](file://src/hosts/vscode/hostbridge/workspace/getWorkspacePaths.ts#L1-L7)

### 获取诊断信息
`getDiagnostics`方法用于获取工作区中所有文件的诊断信息（如错误、警告）。此方法返回包含每个文件诊断信息的对象数组。

```typescript
import { HostProvider } from "@hosts/host-provider"

try {
  const response = await HostProvider.workspace.getDiagnostics()
  console.log(`找到${response.fileDiagnostics.length}个文件的诊断信息`)
  
  // 分析诊断信息以提供AI建议
  for (const fileDiag of response.fileDiagnostics) {
    for (const diag of fileDiag.diagnostics) {
      if (diag.severity === 1) { // 错误
        console.log(`错误在${fileDiag.filePath}:${diag.range.start.line}`)
        // AI代理可以针对这些错误提供修复建议
        const fixSuggestion = await generateFixSuggestion(fileDiag.filePath, diag)
        console.log("修复建议:", fixSuggestion)
      }
    }
  }
} catch (error) {
  console.error("获取诊断信息失败:", error)
}
```

此功能在AI辅助调试中至关重要，AI代理可以分析这些诊断信息，主动提供错误修复建议。

**Section sources**
- [getDiagnostics.ts](file://src/hosts/vscode/hostbridge/workspace/getDiagnostics.ts#L1-L68)

### 打开cline侧边栏面板
`openClineSidebarPanel`方法用于打开cline扩展的侧边栏面板。此方法不接收参数，执行后将焦点切换到cline侧边栏。

```typescript
import { HostProvider } from "@hosts/host-provider"

try {
  await HostProvider.workspace.openClineSidebarPanel()
  console.log("cline侧边栏已打开")
} catch (error) {
  console.error("打开侧边栏失败:", error)
}
```

当AI代理完成任务或需要用户交互时，可以使用此功能自动打开cline侧边栏，引导用户查看结果或进行下一步操作。

**Section sources**
- [openClineSidebarPanel.ts](file://src/hosts/vscode/hostbridge/workspace/openClineSidebarPanel.ts#L1-L9)