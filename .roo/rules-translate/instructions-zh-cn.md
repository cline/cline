# Simplified Chinese (zh-CN) Translation Guidelines

## Key Terminology

| English Term          | Preferred (zh-CN) | Avoid        | Context/Notes |
| --------------------- | ----------------- | ------------ | ------------- |
| API Cost              | API 费用          | API 成本     | 财务相关术语  |
| Tokens                | Token             | Tokens/令牌  | 保留抽象术语  |
| Token Usage           | Token 使用量      | Token 用量   | 技术计量单位  |
| Cache                 | 缓存              | 高速缓存     | 简洁优先      |
| Context               | 上下文            |              | 保留抽象术语  |
| Context Menu          | 右键菜单          | 上下文菜单   | 技术术语准确  |
| Context Window        | 上下文窗口        |              | 技术术语准确  |
| Proceed While Running | 强制继续          | 运行时继续   | 操作命令      |
| Enhance Prompt        | 增强提示词        | 优化提示     | AI相关功能    |
| Auto-approve          | 自动批准          | 始终批准     | 权限相关术语  |
| Checkpoint            | 存档点            | 检查点/快照  | 技术概念统一  |
| MCP Server            | MCP 服务          | MCP 服务器   | 技术组件      |
| Human Relay           | 人工辅助模式      | 人工中继     | 功能描述清晰  |
| Network Timeout       | 请求超时          | 网络超时     | 更准确描述    |
| Terminal              | 终端              | 命令行       | 技术术语统一  |
| diff                  | 差异更新          | 差分/补丁    | 代码变更      |
| prompt caching        | 提示词缓存        | 提示缓存     | AI功能        |
| computer use          | 计算机交互        | 计算机使用   | 技术能力      |
| rate limit            | API 请求频率限制  | 速率限制     | API控制       |
| Browser Session       | 浏览器会话        | 浏览器进程   | 技术概念      |
| Run Command           | 运行命令          | 执行命令     | 操作动词      |
| power steering mode   | 增强导向模式      | 动力转向模式 | 避免直译      |
| Boomerang Tasks       | 任务拆分          | 回旋镖任务   | 避免直译      |

## Formatting Rules

1. **中英文混排**

    - 添加空格：在中文和英文/数字之间添加空格，如"API 费用"（不是"API费用"）
    - 单位格式：时间单位统一为"15秒"、"1分钟"（不是"15 seconds"、"1 minute"）
    - 数字范围："已使用: {{used}} / {{total}}"
    - 技术符号保留原样："{{amount}} tokens"→"{{amount}}"

2. **标点符号**

    - 使用中文全角标点
    - 列表项使用中文顿号："创建、编辑文件"

3. **UI文本优化**

    - 按钮文本：使用简洁动词，如"展开"优于"查看更多"
    - 操作说明：使用步骤式说明（1. 2. 3.）替代长段落
    - 错误提示：使用"确认删除？此操作不可逆"替代"Are you sure...?"
    - 操作说明要简洁："Shift+拖拽文件"优于长描述
    - 按钮文本控制在2-4个汉字："展开"优于"查看更多"

4. **技术描述**

    - 保留英文缩写：如"MCP"不翻译
    - 统一术语：整个系统中相同概念使用相同译法
    - 长句拆分为短句
    - 被动语态转为主动语态
    - 功能名称统一："计算机交互"优于"计算机使用"
    - 参数说明："差异更新"优于"差分/补丁"

5. **变量占位符**
    - 保持原格式：`{{variable}}`
    - 中文说明放在变量外："Token 使用量: {{used}}"

## UI Element Translation Standards

1. **按钮(Buttons)**

    - 确认类：确定/取消/应用/保存
    - 操作类：添加/删除/编辑/导出
    - 状态类：启用/禁用/展开/收起
    - 长度限制：2-4个汉字

2. **菜单(Menus)**

    - 主菜单：文件/编辑/视图/帮助
    - 子菜单：使用">"连接，如"文件>打开"
    - 快捷键：保留英文，如"Ctrl+S"

3. **标签(Labels)**

    - 设置项：描述功能，如"自动保存间隔"
    - 状态提示：简洁明确，如"正在处理..."
    - 单位说明：放在括号内，如"超时时间(秒)"

4. **工具提示(Tooltips)**

    - 功能说明：简洁描述，如"复制选中内容"
    - 操作指引：步骤明确，如"双击编辑单元格"
    - 长度限制：不超过50个汉字

5. **对话框(Dialogs)**
    - 标题：说明对话框用途
    - 正文：分段落说明
    - 按钮：使用动词，如"确认删除"

## Contextual Translation Principles

1. **根据UI位置调整**

    - 按钮文本：简洁动词 (如"展开", "收起")
    - 设置项：描述性 (如"自动批准写入操作")
    - 帮助文本：完整说明 (如"开启后自动创建任务存档点，方便回溯修改")

2. **技术文档风格**

    - 使用主动语态：如"自动创建和编辑文件"
    - 避免口语化表达
    - 复杂功能使用分点说明
    - 说明操作结果：如"无需二次确认"
    - 参数说明清晰：如"延迟一段时间再自动批准写入"

3. **品牌/产品名称**

    - 保留英文品牌名
    - 技术术语保持一致性
    - 保留英文专有名词：如"AWS Bedrock ARN"

4. **用户操作**
    - 操作动词统一：
        - "Click"→"点击"
        - "Type"→"输入"
        - "Scroll"→"滚动"
    - 按钮状态：
        - "Enabled"→"已启用"
        - "Disabled"→"已禁用"

## Technical Documentation Guidelines

1. **技术术语**

    - 统一使用"Token"而非"令牌"
    - 保留英文专有名词：如"Model Context Protocol"
    - 功能名称统一：如"计算机功能调用"优于"计算机使用"

2. **API文档**

    - 端点(Endpoint)：保留原始路径
    - 参数说明：表格形式展示
    - 示例：保留代码格式
    - 参数标签：
        - 单位明确：如"最大输出 Token 数"
        - 范围说明完整：如"模型可以处理的总 Token 数"

3. **代码相关翻译**

    - 代码注释：
        - 保留技术术语：如"// Initialize MCP client"
        - 简短说明：如"检查文件是否存在"
    - 错误信息：
        - 包含错误代码：如"Error 404: 文件未找到"
        - 提供解决方案：如"请检查文件权限"
    - 命令行：
        - 保留原生命令：如"git commit -m 'message'"
        - 参数说明：如"-v: 显示详细输出"

4. **配置指南**
    - 设置项命名：如"Enable prompt caching"→"启用提示词缓存"
    - 价格描述：
        - 单位统一：如"每百万 Token 的成本"
        - 说明影响：如"这会影响生成内容和补全的成本"
    - 操作说明：
        - 使用编号步骤：如"1. 注册Google Cloud账号"
        - 步骤动词一致：如"安装配置Google Cloud CLI工具"

## Common Patterns

```markdown
<<<<<<< BEFORE
"dragFiles": "按住shift拖动文件"
=======
"dragFiles": "Shift+拖拽文件"

> > > > > > > AFTER

<<<<<<< BEFORE
"description": "启用后，Roo 将能够与 MCP 服务器交互以获取高级功能。"
=======
"description": "启用后 Roo 可与 MCP 服务交互获取高级功能。"

> > > > > > > AFTER

<<<<<<< BEFORE
"cannotUndo": "此操作无法撤消。"
=======
"cannotUndo": "此操作不可逆。"

> > > > > > > AFTER

<<<<<<< BEFORE
"hold shift to drag in files" → "按住shift拖动文件"
=======
"hold shift to drag in files" → "Shift+拖拽文件"

> > > > > > > AFTER

<<<<<<< BEFORE
"Double click to edit" → "双击进行编辑"
=======
"Double click to edit" → "双击编辑"

> > > > > > > AFTER
```

## Common Pitfalls

1. 避免过度直译导致生硬

    - ✗ "Do more with Boomerang Tasks" → "使用回旋镖任务完成更多工作"
    - ✓ "Do more with Boomerang Tasks" → "允许任务拆分"

2. 保持功能描述准确

    - ✗ "Enhance prompt with additional context" → "使用附加上下文增强提示"
    - ✓ "Enhance prompt with additional context" → "增强提示词"

3. 操作指引清晰

    - ✗ "hold shift to drag in files" → "按住shift拖动文件"
    - ✓ "hold shift to drag in files" → "Shift+拖拽文件"

4. 确保术语一致性

    - ✗ 同一文档中混用"Token"/"令牌"/"代币"
    - ✓ 统一使用"Token"作为技术术语

5. 注意文化适应性

    - ✗ "Kill the process" → "杀死进程"(过于暴力)
    - ✓ "Kill the process" → "终止进程"

6. 技术文档特殊处理
    - 代码示例中的注释：
      ✗ 翻译后破坏代码结构
      ✓ 保持代码注释原样或仅翻译说明部分
    - 命令行参数：
      ✗ 翻译参数名称导致无法使用
      ✓ 保持参数名称英文，仅翻译说明

## Best Practices

1. **翻译工作流程**

    - 通读全文理解上下文
    - 标记并统一技术术语
    - 分段翻译并检查一致性
    - 最终整体审校

2. **质量检查要点**

    - 术语一致性
    - 功能描述准确性
    - UI元素长度适配性
    - 文化适应性

3. **工具使用建议**

    - 建立项目术语库
    - 使用翻译记忆工具
    - 维护风格指南
    - 定期更新翻译资源

4. **审校流程**
    - 初翻 → 技术审校 → 语言润色 → 最终确认
    - 重点关注技术准确性、语言流畅度和UI显示效果

## Quality Checklist

1. 术语是否全文一致？
2. 是否符合中文技术文档习惯？
3. UI控件文本是否简洁明确？
4. 长句是否已合理拆分？
5. 变量占位符是否保留原格式？
6. 技术描述是否准确无误？
7. 文化表达是否恰当？
8. 是否保持了原文的精确含义？
9. 特殊格式(如变量、代码)是否正确保留？
