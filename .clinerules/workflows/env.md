# 环境变量测试工作流

此工作流演示如何使用 [execute_command](file:///devdata/code/cline-can/cline/src/core/task/tools/handlers/ExecuteCommandToolHandler.ts#L17-L17) 工具读取系统环境变量并将其显示给用户。

<task>/env</task>

## 步骤

1. 首先，让我们读取 PATH 环境变量：

<execute_command>
<command>
echo $PATH
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

2. 现在让我们检查 HOME 目录：

<execute_command>
<command>
echo $HOME
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

3. 让我们 also 检查当前工作目录：

<execute_command>
<command>
pwd
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

4. 最后，让我们查看所有环境变量：

<execute_command>
<command>
env | head -20
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

5. 检查 MATRIX_FILE_PATH 环境变量（如果已设置）：

<execute_command>
<command>
if [ -n "$MATRIX_FILE_PATH" ]; then
    echo "MATRIX_FILE_PATH is set to: $MATRIX_FILE_PATH"
else
    echo "MATRIX_FILE_PATH is not set"
fi
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

6. 如果 MATRIX_FILE_PATH 已设置，检查文件是否存在：

<execute_command>
<command>
if [ -n "$MATRIX_FILE_PATH" ] && [ -f "$MATRIX_FILE_PATH" ]; then
    echo "Matrix file exists:"
    echo "  Path: $MATRIX_FILE_PATH"
    echo "  Size: $(stat -f%z "$MATRIX_FILE_PATH" 2>/dev/null || stat -c%s "$MATRIX_FILE_PATH" 2>/dev/null || echo "unknown") bytes"
else
    echo "MATRIX_FILE_PATH is not set or file does not exist"
fi
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

7. 如果 MATRIX_FILE_PATH 已设置且文件存在，显示文件内容摘要：

<execute_command>
<command>
if [ -n "$MATRIX_FILE_PATH" ] && [ -f "$MATRIX_FILE_PATH" ]; then
    echo "Matrix file content summary:"
    echo "First 5 lines:"
    head -5 $MATRIX_FILE_PATH
    echo ""
    echo "Last 5 lines:"
    tail -5 $MATRIX_FILE_PATH
else
    echo "No matrix file to display"
fi
</command>
<requires_approval>
false
</requires_approval>
</execute_command>

8. 总结以上所有命令的执行结果：

<attempt_completion>
<result>
环境变量读取完成。以上命令的执行结果已显示给用户：

1. PATH 环境变量: 包含系统可执行文件的搜索路径
2. HOME 目录: 用户的主目录路径
3. 当前工作目录: 当前所在的目录路径
4. 环境变量列表: 显示了前20个环境变量及其值
5. MATRIX_FILE_PATH: 矩阵文件路径（如果已设置）
6. 矩阵文件存在性检查: 检查 MATRIX_FILE_PATH 指向的文件是否存在
7. 矩阵文件内容摘要: 如果 MATRIX_FILE_PATH 已设置且文件存在，则显示文件的前后各5行内容

这些信息可以帮助用户了解系统的环境配置，特别是与矩阵文件处理相关的配置。
</result>
</attempt_completion>