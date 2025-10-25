export const Dbc2MatrixFileParsePrompt=()=>
`
<explicit_instructions type="matrix_file_parse">
# DBC解析交互式工作流

## 目标
处理 从CAN-DBC文件根据用户偏好转换为CAN矩阵文件。

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

 

## 步骤 1: 调用Mcp将DBC文件转换为CAN矩阵文件

  调用 MCP 服务,对传入的DBC文件url $TASK_FILES 进行处理生成对应矩阵文件：

    <use_mcp_tool>
      <server_name>
        can-tools
      </server_name>
      <tool_name>
        handle_generate_matrix_excel
      </tool_name>
      <arguments>
      {
        "fileUrl": "$TASK_FILES"      
      }
      </arguments>
    </use_mcp_tool>
  该Mcp调用会返回一个JSON对象，包含字段根据$code_type的值不同：
    ### 如果$code_type为C，则包含字段：
      - **excel_file_url**：生成的矩阵文件的文件URL    

  
  将生成的矩阵文件的文件URL存储在变量$excel_file_url中。

## 步骤 2: 将生成的矩阵文件保存到本地项目的指定目录
  -先先使用内置工具**select_file**,让用户选择/输入**当前打开**的项目的**根目录**下一个目录路径:
    <select_file>
      <title>请选择要保存矩阵文件的目录</title>
      <canSelectFiles>false</canSelectFiles>
      <canSelectFolders>true</canSelectFolders>
      <canSelectMany>false</canSelectMany>
    </select_file>

   将用户选中的目录路径存储在变量$excel_file_path中(检查该目录是否存在，不存在则创建)；  
  -然后调用内置工具**download_file**工具将生成的矩阵文件$excel_file_url下载到$excel_file_path中。
  -文件保存到本地时，请简化本地文件名，去掉文件名下划线后面的Md5。
   <download_file>
    <fileUrl>$excel_file_url </fileUrl>
    <savePath>$excel_file_path</savePath>
   </download_file>

  -**注意！！！**：请必须确保下载文件成功，不要略过此步骤！！！。
  -**注意！！！**：请**必须保直接下载文件保存到本地文件，不要试图fetch 文件内容返回！！**。  

## 步骤 3: 任务完成
  通知用户任务已完成,并输出前面步骤中生成的矩阵文件文件的url 链接，让用户能够下载。
  <attempt_completion>

  <result>
  
    生成的代码文件下载： $excel_file_url

    已保存的文件路径： $excel_file_path
     


  </result>

  </attempt_completion>


</explicit_instructions>


`