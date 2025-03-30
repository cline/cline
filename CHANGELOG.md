# 更新日志

## [3.8.4.1]
-   2025年3月31日 - 发布小版本更新
-   修复 OpenRouter 回调 URL 中的扩展 ID 为 cline-cn.cline-cn

## [3.8.4]
-   2025年3月30日 - 发布 中华人民共和国中文版本 3.8.4
-   添加 Sambanova Deepseek-V3-0324
-   为 LiteLLM provider 添加成本计算支持
-   修复 Cline 在没有 response 参数时使用 plan_mode_response 的错误

## [3.8.3]

-   添加对 SambaNova QwQ-32B 模型的支持
-   添加 OpenAI "dynamic" 模型 chatgpt-4o-latest
-   在 AWS Bedrock 中添加 Amazon Nova 模型
-   改进 NextJS 文件夹命名的文件处理（修复文件夹名中带括号的问题）
-   在 Google AI Studio 可用模型中添加 Gemini 2.5 Pro
-   处理 Anthropic 的"输入过大"错误
-   修复任务展开后"查看更多"按钮不显示的问题
-   修复 gpt-4.5-preview 的 supportsPromptCache 值为 true

## [3.8.2]

-   修复切换到计划/执行模式时导致 VS Code LM/OpenRouter 模型重置的错误

## [3.8.0]

-   在文件或终端右键菜单中添加"添加到 Cline"选项，使向当前任务添加上下文更容易
-   添加"使用 Cline 修复"代码操作 - 当你在编辑器中看到灯泡图标时，现在可以选择"使用 Cline 修复"来发送代码和相关错误让 Cline 修复（Cursor 用户也可以使用"快速修复 (CMD + .)"菜单查看此选项）
-   添加账户视图，显示 Cline 账户用户的计费和使用历史。现在你可以直接在扩展中跟踪已使用的积分和交易历史！
-   为 Cline/OpenRouter 添加"排序底层提供商路由"设置，允许你按吞吐量、价格、延迟或默认方式（价格和正常运行时间的组合）对使用的提供商进行排序
-   通过动态图像加载和对 GIF 的支持改进富 MCP 显示
-   添加"文档"菜单项以轻松访问 Cline 的文档
-   添加 OpenRouter 的新 usage_details 功能，提供更可靠的成本报告
-   在历史视图中的"删除所有任务"按钮旁显示 Cline 占用的总磁盘空间
-   修复 OpenRouter/Cline 账户的"上下文窗口超出"错误（更多支持即将推出）
-   修复 OpenRouter 模型 ID 被设置为无效值的错误
-   添加删除故障状态 MCP 服务器的按钮

## [3.7.1]

-   修复开始新任务时任务标题中"查看更多"按钮不显示的问题
-   修复使用本地 git commit hooks 的检查点问题

## [3.7.0]

-   Cline 现在在提问或提出计划时会显示可选择的选项，让你不必手动输入回复！
-   添加对 `.clinerules/` 目录的支持，可一次加载多个文件（感谢 @ryo-ma！）
-   防止 Cline 读取会超出上下文窗口的极大文件
-   改进检查点加载性能，并为不适合使用检查点的大型项目显示警告
-   添加 SambaNova API provider（感谢 @saad-noodleseed！）
-   为 AWS Bedrock profiles 添加 VPC endpoint 选项（感谢 @minorunara！）
-   在 AWS Bedrock 中添加 DeepSeek-R1（感谢 @watany-dev！）

## [3.6.5]

-   在历史视图中添加"删除所有任务历史"按钮
-   在设置中添加禁用计划/执行模式之间模型切换的开关（新用户默认禁用）
-   为 OpenAI Compatible 添加温度选项
-   为 tree-sitter 解析器添加 Kotlin 支持（感谢 @fumiya-kume！）

## [3.6.3]

-   改进 Alibaba（感谢 @meglinge！）和 OpenRouter 的 QwQ 支持
-   改进差异编辑提示，防止当模型使用的搜索模式在文件中没有匹配项时立即回退到 write_to_file
-   修复新检查点系统在任务之间切换时会回退文件更改的错误
-   修复某些 OpenAI compatible providers 的令牌计数不正确的问题

## [3.6.0]

-   添加 Cline API 作为提供商选项，允许新用户免费注册并开始使用 Cline
-   通过每个任务一个分支的策略优化检查点，减少所需存储空间和首次任务加载时间
-   修复 Windows 上计划/执行切换键盘快捷键不工作的问题（感谢 @yt3trees！）
-   为 GCP Vertex 添加新的 Gemini 模型（感谢 @shohei-ihaya！）和 AskSage 的 Claude 模型（感谢 @swhite24！）
-   改进 OpenRouter/Cline 错误报告

## [3.5.1]

-   为 MCP 服务器添加超时选项
-   为 Vertex provider 添加 Gemini Flash 模型（感谢 @jpaodev！）
-   为 AWS Bedrock provider 添加提示缓存支持（感谢 @buger！）
-   添加 AskSage provider（感谢 @swhite24！）

## [3.5.0]

-   为 Claude 3.7 Sonnet 添加"启用扩展思考"选项，能够为计划和执行模式设置不同的预算
-   添加对富 MCP 响应的支持，包括自动图像预览、网站缩略图和 WolframAlpha 可视化
-   在高级设置中添加语言偏好选项
-   添加 xAI Provider 集成，支持所有 Grok 模型（感谢 @andrewmonostate！）
-   修复 Linux XDG 指向错误文档文件夹路径的问题（感谢 @jonatkinson！）

## [3.4.10]

-   添加对 GPT-4.5 preview 模型的支持

## [3.4.9]

-   添加开关让用户选择加入匿名遥测和错误报告

## [3.4.6]

-   添加对 Claude 3.7 Sonnet 的支持

## [3.4.0]

-   推出 MCP 市场！现在你可以直接在扩展中发现和安装最好的 MCP 服务器，新服务器会定期添加
-   在计划模式中添加 mermaid 图表支持！现在你可以在聊天中看到 mermaid 代码块的可视化表示，并点击查看展开视图
-   在编辑文件和运行命令后使用更多可视化检查点指示器
-   在每个任务开始时创建检查点，以便轻松恢复到初始状态
-   添加"终端"上下文提示以引用活动终端的内容
-   添加"Git 提交"上下文提示以引用当前工作更改或特定提交（感谢 @mrubens！）
-   从计划模式切换到执行模式时，或点击"批准"按钮时，发送当前文本字段内容作为额外反馈
-   为 OpenAI Compatible 添加高级配置选项（上下文窗口、最大输出、定价等）
-   添加阿里巴巴 Qwen 2.5 coder 模型、VL 模型和 DeepSeek-R1/V3 支持
-   改进对 AWS Bedrock Profiles 的支持
-   修复 Mistral provider 对非 codestral 模型的支持
-   添加禁用浏览器工具的高级设置
-   添加为浏览器工具设置 chromium 可执行文件路径的高级设置

## [3.3.2]

-   修复 OpenRouter 请求偶尔不返回成本/令牌统计的错误，导致上下文窗口限制错误
-   使检查点更加可见并跟踪已恢复的检查点

## [3.3.0]

-   添加 .clineignore 以阻止 Cline 访问指定的文件模式
-   添加计划/执行切换的键盘快捷键和工具提示
-   修复新文件不会在文件下拉列表中显示的错误
-   添加对速率限制请求的自动重试（感谢 @ViezeVingertjes！）
-   在高级设置中为 o3-mini 添加 reasoning_effort 支持
-   添加使用 AWS CLI 创建配置文件的 AWS provider profiles 支持，实现与 AWS bedrock 的长期连接
-   添加 Requesty API provider
-   添加 Together API provider
-   添加阿里巴巴 Qwen API provider（感谢 @aicccode！）

## [3.2.13]

-   添加新的 gemini 模型 gemini-2.0-flash-lite-preview-02-05 和 gemini-2.0-flash-001
-   添加所有可用的 Mistral API 模型（感谢 @ViezeVingertjes！）
-   添加 LiteLLM API provider 支持（感谢 @him0！）

## [3.2.12]

-   修复 Windows 用户的命令链接
-   修复 OpenAI providers 的 reasoning_content 错误

## [3.2.11]

-   添加 OpenAI o3-mini 模型

## [3.2.10]

-   改进对 DeepSeek-R1（deepseek-reasoner）模型的支持，适用于 OpenRouter、OpenAI-compatible 和 DeepSeek direct（感谢 @Szpadel！）
-   显示支持它的模型的推理令牌
-   修复在计划/执行模式之间切换模型的问题

## [3.2.6]

-   在计划和执行之间切换时保存最后使用的 API/模型，适用于喜欢为每种模式使用不同模型的用户
-   任务标题中新增上下文窗口进度条，帮助理解随着上下文增加而增加的成本/生成降级
-   本地化 README 并添加英语、西班牙语、德语、中文和日语的语言选择器
-   添加高级设置，可从请求中删除 MCP 提示以节省令牌，为不使用 git 的用户启用/禁用检查点（更多功能即将推出！）
-   添加 Gemini 2.0 Flash Thinking 实验性模型
-   允许新用户订阅邮件列表，在新的账户选项可用时获得通知

## [3.2.5]

-   在计划模式中使用黄色文本字段轮廓，以更好地与执行模式区分

## [3.2.3]

-   添加对 DeepSeek-R1（deepseek-reasoner）模型的支持，并提供适当的参数处理（感谢 @slavakurilyak！）

## [3.2.0]

-   添加计划/执行模式切换，让你在让 Cline 开始工作之前先计划任务
-   使用聊天字段下的新弹出菜单轻松在 API 提供商和模型之间切换
-   添加 VS Code LM API provider 以运行其他 VS Code 扩展提供的模型（例如 GitHub Copilot）。感谢 @julesmons、@RaySinner 和 @MrUbens 的共同努力！
-   为 MCP 服务器添加开/关切换，以在不使用时禁用它们。感谢 @MrUbens！
-   为 MCP 服务器中的单个工具添加自动批准选项。感谢 @MrUbens！

## [3.1.10]

-   新图标！

## [3.1.9]

-   添加 Mistral API provider，支持 codestral-latest 模型

## [3.1.7]

-   当 Cline 请求启动浏览器时，添加更改视口大小和无头模式的功能

## [3.1.6]

-   修复带有中文字符的文件路径在上下文提示菜单中不显示的错误（感谢 @chi-chat！）
-   更新 Anthropic 模型价格（感谢 @timoteostewart！）

## [3.1.5]

-   修复 Cline 无法从工具结果中读取"@/"导入路径别名的错误

## [3.1.4]

-   修复对全局启用 git commit 签名的用户检查点不工作的问题

## [3.1.2]

-   修复创建检查点时不会忽略 LFS 文件的问题

## [3.1.0]

-   添加检查点：每当 Cline 使用工具时自动创建工作区快照
    -   比较更改：悬停在任何工具使用上可以查看快照和当前工作区状态之间的差异
    -   恢复选项：选择仅恢复任务状态、仅恢复工作区文件或两者都恢复
-   任务完成后出现新的"查看新更改"按钮，提供所有工作区更改的概览
-   任务标题现在显示磁盘空间使用情况，并带有删除按钮以帮助管理快照存储

## [3.0.12]

-   修复 DeepSeek API 成本报告（输入价格为 0，因为它都是缓存读取或写入，与 Anthropic 报告缓存使用的方式不同）

## [3.0.11]

-   在文件编辑响应中强调编辑器完成的自动格式化，以实现更可靠的差异编辑

## [3.0.10]

-   将 DeepSeek provider 添加到 API Provider 选项
-   修复 DeepSeek v3 的上下文窗口限制错误

## [3.0.9]

-   修复 DeepSeek v3 在差异编辑中错误转义 HTML 实体的问题

## [3.0.8]

-   通过在系统提示中添加"自动格式化考虑"来缓解 DeepSeek v3 差异编辑错误，鼓励模型使用更新的文件内容作为 SEARCH 块的参考点

## [3.0.7]

-   恢复使用批处理文件监视器，修复同时创建多个文件时崩溃的问题

## [3.0.6]

-   修复某些文件在 `@` 上下文提示菜单中缺失的错误
-   在其他区域添加 Bedrock 支持
-   差异编辑改进
-   为不使用提示缓存的模型添加 OpenRouter 的 middle-out 转换（防止上下文窗口限制错误，但不能应用于像 Claude 这样的模型，因为它会持续破坏缓存）

## [3.0.4]

-   修复 gemini 模型在文本内容末尾添加代码块工件的错误
-   修复浅色主题上下文提示菜单的视觉问题

## [3.0.2]

-   添加块锚点匹配以实现更可靠的差异编辑（如果有 3 行或更多行，使用第一行和最后一行作为搜索锚点）
-   在系统提示中添加指令，在差异编辑中使用完整行以正确配合回退策略
-   改进差异编辑错误处理
-   添加新的 Gemini 模型

## [3.0.0]

-   Cline 现在在编辑大文件时使用搜索和替换差异的方法，以防止代码删除问题
-   添加对更全面的自动批准配置的支持，允许你指定哪些工具需要批准，哪些不需要
-   添加启用系统通知的功能，在 Cline 需要批准或完成任务时通知
-   添加对根级别 `.clinerules` 文件的支持，可用于为项目指定自定义指令

## [2.2.0]

-   添加对模型上下文协议（MCP）的支持，使 Cline 能够使用自定义工具，如网络搜索工具或 GitHub 工具
-   添加可通过菜单栏中的服务器图标访问的 MCP 服务器管理选项卡
-   添加 Cline 根据用户请求动态创建新 MCP 服务器的功能（例如，"添加一个获取最新 npm 文档的工具"）

## [2.1.6]

-   添加 LM Studio 作为 API provider 选项（确保使用扩展前启动 LM Studio 服务器！）

## [2.1.5]

-   为 OpenRouter 上的新 Claude 模型 ID 添加提示缓存支持（例如 `anthropic/claude-3.5-sonnet-20240620`）

## [2.1.4]

-   AWS Bedrock 修复（添加缺失的区域，支持跨区域推理，以及为新模型不可用的区域提供旧版 Sonnet 模型）

## [2.1.3]

-   添加对 Claude 3.5 Haiku 的支持，比 Sonnet 便宜 66%，智能程度相似

## [2.1.2]

-   各种错误修复
-   使用新的浏览器功能更新 README

## [2.1.1]

-   添加更严格的提示，防止 Cline 在浏览器会话期间在未关闭浏览器的情况下编辑文件

## [2.1.0]

-   Cline 现在使用 Anthropic 的新"计算机使用
