import { AssistantMessageContent, TextContent, ToolUse, ToolParamName, toolParamNames, toolUseNames, ToolUseName } from "."

export function parseAssistantMessage(assistantMessage: string) {
 // 初始化内容块数组，用于存储解析后的文本和工具使用信息
 let contentBlocks: AssistantMessageContent[] = []
 // 当前文本内容对象，用于存储解析中的文本信息
 let currentTextContent: TextContent | undefined = undefined
 // 当前文本内容开始的索引
 let currentTextContentStartIndex = 0
 // 当前工具使用对象，用于存储解析中的工具使用信息
 let currentToolUse: ToolUse | undefined = undefined
 // 当前工具使用开始的索引
 let currentToolUseStartIndex = 0
 // 当前参数名称，用于存储解析中的工具参数名称
 let currentParamName: ToolParamName | undefined = undefined
 // 当前参数值开始的索引
 let currentParamValueStartIndex = 0
 // 累加器，用于存储解析过程中的字符
 let accumulator = ""

 // 遍历助理消息字符串中的每个字符
 for (let i = 0; i < assistantMessage.length; i++) {
  const char = assistantMessage[i]
  accumulator += char

  // 如果当前有工具使用并且有参数名称，解析参数值
  if (currentToolUse && currentParamName) {
   const currentParamValue = accumulator.slice(currentParamValueStartIndex)
   const paramClosingTag = `</${currentParamName}>`
   if (currentParamValue.endsWith(paramClosingTag)) {
    // 结束参数值解析
    currentToolUse.params[currentParamName] = currentParamValue.slice(0, -paramClosingTag.length).trim()
    currentParamName = undefined
    continue
   } else {
    // 部分参数值正在累积
    continue
   }
  }

  // 如果当前没有参数名称，检查是否有工具使用开始
  if (currentToolUse) {
   const currentToolValue = accumulator.slice(currentToolUseStartIndex)
   const toolUseClosingTag = `</${currentToolUse.name}>`
   if (currentToolValue.endsWith(toolUseClosingTag)) {
    // 结束工具使用解析
    currentToolUse.partial = false
    contentBlocks.push(currentToolUse)
    currentToolUse = undefined
    continue
   } else {
    // 检查是否有新的参数开始
    const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`)
    for (const paramOpeningTag of possibleParamOpeningTags) {
     if (accumulator.endsWith(paramOpeningTag)) {
      // 开始新的参数
      currentParamName = paramOpeningTag.slice(1, -1) as ToolParamName
      currentParamValueStartIndex = accumulator.length
      break
     }
    }

    // 特殊处理 write_to_file 工具，确保内容参数正确解析
    const contentParamName: ToolParamName = "content"
    if (currentToolUse.name === "write_to_file" && accumulator.endsWith(`</${contentParamName}>`)) {
     const toolContent = accumulator.slice(currentToolUseStartIndex)
     const contentStartTag = `<${contentParamName}>`
     const contentEndTag = `</${contentParamName}>`
     const contentStartIndex = toolContent.indexOf(contentStartTag) + contentStartTag.length
     const contentEndIndex = toolContent.lastIndexOf(contentEndTag)
     if (contentStartIndex !== -1 && contentEndIndex !== -1 && contentEndIndex > contentStartIndex) {
      currentToolUse.params[contentParamName] = toolContent.slice(contentStartIndex, contentEndIndex).trim()
     }
    }

    // 部分工具使用值正在累积
    continue
   }
  }

  // 如果当前没有工具使用，解析文本内容
  let didStartToolUse = false
  const possibleToolUseOpeningTags = toolUseNames.map((name) => `<${name}>`)
  for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
   if (accumulator.endsWith(toolUseOpeningTag)) {
    // 开始新的工具使用
    currentToolUse = {
     type: "tool_use",
     name: toolUseOpeningTag.slice(1, -1) as ToolUseName,
     params: {},
     partial: true,
    }
    currentToolUseStartIndex = accumulator.length
    // 结束当前文本内容解析
    if (currentTextContent) {
     currentTextContent.partial = false
     // 移除文本末尾的部分工具使用标签
     currentTextContent.content = currentTextContent.content
      .slice(0, -toolUseOpeningTag.slice(0, -1).length)
      .trim()
     contentBlocks.push(currentTextContent)
     currentTextContent = undefined
    }

    didStartToolUse = true
    break
   }
  }

  if (!didStartToolUse) {
   // 如果没有工具使用，解析文本内容
   if (currentTextContent === undefined) {
    currentTextContentStartIndex = i
   }
   currentTextContent = {
    type: "text",
    content: accumulator.slice(currentTextContentStartIndex).trim(),
    partial: true,
   }
  }
 }

 // 如果助理消息以部分工具使用结束，将其添加到内容块中
 if (currentToolUse) {
  if (currentParamName) {
   // 如果工具使用有未完成的参数，将其添加到工具使用对象中
   currentToolUse.params[currentParamName] = accumulator.slice(currentParamValueStartIndex).trim()
  }
  contentBlocks.push(currentToolUse)
 }

 // 如果助理消息以部分文本内容结束，将其添加到内容块中
 if (currentTextContent) {
  contentBlocks.push(currentTextContent)
 }

 // 返回解析后的内容块数组
 return contentBlocks
}