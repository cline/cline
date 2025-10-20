export const MatrixFileParsePrompt=()=>
`
<explicit_instructions type="matrix_file_parse">
# 矩阵解析交互式工作流

## 目标
处理 CAN 矩阵文件并将其转换为 DBC 格式，每一步都与用户进行交互，然后根据用户偏好生成 C/Java 代码。

##规则指导
- **非常重要**：请一直用中文进行思考与推理
- **非常重要**：除非步骤中明确需要与用户进行交互，否则请不要描述自己的**任何**行为与推理过程，直接执行必要的操作。
- **重要**：除非用户要求，不要用不必要的开场或收尾。
- 如果不能或不愿提供帮助，请避免解释动机或后果，免得显得说教

## 交互指南
- 在每一步中，使用适当的 Cline 工具展示结果并请求用户确认
- 如果用户提供反馈，将其纳入下一步处理
- 仅在整個過程完成並獲得用戶批准時才使用 attempt_completion
- 优雅地处理错误并提供清晰的错误消息
- 在整个工作流中保持上下文以确保一致的用户体验
- 在所有步骤中，除非有明确要求与用户进行交互的之外，请**不要输出任何描述性的文字与推理过程，直接调用对应的工具，并仅输出工具直接返回**


## 技術实现说明
- 使用 use_mcp_tool 调用各种 MCP 服务处理文件
- 必要时将文件内容作为 base64 编码字符串处理
- 验证所有用户输入和文件格式
- 在每个阶段提供清晰的进度指示器
- 支持从任何步骤恢复

## 上下文传递说明
- 文件路径通过任务系统上下文传递，后续的步骤用$TASK_FILES来代表。$TASK_FILES 应为字符串（单个文件路径）或字符串数组（多个文件路径），格式为绝对或相对路径，根据任务系统实际传递内容决定。
- MCP 工具处理后返回结果，供后续步骤使用
- 后续步骤可以通过解析 TASK_FILES 获取原始文件路径或使用 MCP 工具返回的结果

## 步骤 1: 让用户选择上传的矩阵文件中需要处理的Sheet
  让用户从传入的**矩阵文件的Sheet列表**中选择一个作为待处理的Sheet,并将选择的Sheet名称存储在变量sheet_name中，
  这个变量后续的步骤用$sheet_name来代表
  ,然后进入下一步。

  <ask_followup_question>
    <question>请选择要处理的Sheet：</question>
    <options>入的**矩阵文件的Sheet列表**</options>
  </ask_followup_question>

## 步骤 2: 矩阵文件转换为DBC文件
  调用 MCP 服务处理上传的矩阵文件将其转换为DBC文件，此调用会返回一个url，存储在变量dbc_file_url中，这个变量后续的步骤用$dbcFileUrl来代表。

  <use_mcp_tool>
  <server_name>
  can-tools
  </server_name>
  <tool_name>
  handle_matrix_file
  </tool_name>
  <arguments>
  {
    "fileUrl": "$TASK_FILES",
    "sheetName": "$sheet_name"
  }
  </arguments>
  </use_mcp_tool>

## 步骤 3: 将生成的DBC文件下载到本地项目的指定目录
  -先让用户选择/输入本地项目的一个目录路径,将此目录路径存储在变量dbc_file_path中(检查该目录是否存在，不存在则创建)，
  这个变量后续的步骤用$dbc_file_path来代表
  -然后调用**Fetch**MCP服务的**fetch_txt**工具(如果还未安装则自动下载并安装)将生成的DBC文件下载到本地项目的指定目录：
  <use_mcp_tool>
  <server_name>
  Fetch
  </server_name>
  <tool_name>
  fetch_txt
  </tool_name>
  <arguments>
  {
    "url": "$dbcFileUrl",
    "max_length": 10485760,
  }
  </arguments>
  </use_mcp_tool>

  这个Mcp调用会返回该文件的**文本内容**，将获取的文件内容**保存到**$dbc_file_path的下的一个.dbc文件中(如果该文件不存在，则新建后将内容写入；如果文件已存在，用一个新的文件名新建文件后写入获取的内容)，,
  文件的文件名与上传的矩阵文件同名但扩展名为.dbc。
  这个dbc文件的完整路径存储在变量$dbc_file_path中。
  - **注意！！！**：获取的dbc文件请按原始内容写入本地文件中，**不要**进行任何处理，**不要**自行去掉换行，空格符，制表符等。

## 步骤 4: 调用Mcp将DBC文件转换为C/Java代码
  让用户选择生成C代码还是Java代码：
  <ask_followup_question>
    <question>请选择要处理的生成代码语言类型：</question>
    <options>["C","JAVA"]</options>
  </ask_followup_question>
  将此选择存储在变量code_type中，这个变量后续的步骤用$code_type来代表,
  然后调用 MCP 服务处理生成对应代码：

  <use_mcp_tool>
  <server_name>
  can-tools
  </server_name>
  <tool_name>
  handle_generate_c_code
  </tool_name>
  <arguments>
  {
    "fileUrl": "$dbcFileUrl",
    "codeType": "$code_type"
  }
  </arguments>
  </use_mcp_tool>
  该Mcp调用会返回一个JSON对象，包含字段根据$code_type的值不同：
    ### 如果$code_type为C，则包含字段：
      - **header_file_url**：生成的头文件的文件URL 
      - **source_file_url**：生成的代码文件的文件URL

    ### 如果$code_type为Java，则包含字段：
      - **signal_file_url**：生成的信号处理Java代码文件的文件URL
      - **parser_file_url**：生成的转换器Java代码文件的文件URL

  将此JSON对象存储在变量$code_result中，这个变量后续的步骤用$code_result来代表。

## 步骤 5: 将生成的代码保存到本地项目的指定目录
  -先让用户选择/输入**当前打开**的项目的**根目录**下一个目录路径,将此目录路径存储在变量code_file_path中(检查该目录是否存在，不存在则创建)；
   将这些代码文件的完整路径存储在变量$code_file_paths中，这个变量后续的步骤用$code_file_paths来代表。  
  -然后调用**Fetch**MCP服务的**fetch_txt**工具(参数**max_length**设置为10485760)将**所有**生成的代码文件(即存储在$code_result中的文件url)获取，
   并写入到$code_file_paths下的新建文件中；请简化文件名，去掉url文件名下划线后面的Md5。
  - **注意！！！**：获取的代码文件请按原始内容写入本地文件中。**不要**进行任何处理，**不要**自行去掉换行，空格符，制表符等。

  - **注意！！！**：最后生成的代码请检查是否有语法错误，如有语法错误请修正后再保存。
 

## 步骤 6: 任务完成
  通知用户任务已完成,并输出前面步骤中生成的dbc文件url与代码文件的url 链接，让用户能够下载。
  <attempt_completion>

  <result>
    dbc文件下载： $dbcFileUrl
    生成的代码文件下载： 
      如果$code_type为C，则显示：
        头文件: $header_file_url
        源文件: $source_file_url

      如果$code_type为Java，则显示：
        信号处理: $signal_file_url
        转换器: $parser_file_url


  </result>

  </attempt_completion>


</explicit_instructions>


`