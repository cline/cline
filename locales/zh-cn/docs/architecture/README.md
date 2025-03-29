# Cline扩展架构

本目录包含Cline VSCode扩展的架构文档。

## 扩展架构图

[extension-architecture.mmd](./extension-architecture.mmd)文件包含一个Mermaid图表，展示了Cline扩展的高层架构。图表说明了：

1. **核心扩展**
   - 扩展入口点和主要类
   - 通过VSCode的全局状态和秘密存储进行状态管理
   - Cline类中的核心业务逻辑

2. **Webview UI**
   - 基于React的用户界面
   - 通过ExtensionStateContext进行状态管理
   - 组件层次结构

3. **存储**
   - 任务特定存储用于历史和状态
   - 基于Git的检查点系统用于文件更改

4. **数据流**
   - 核心扩展组件之间的数据流
   - Webview UI数据流
   - 核心与webview之间的双向通信

## 查看图表

要查看图表：
1. 在VSCode中安装Mermaid图表查看器扩展
2. 打开extension-architecture.mmd
3. 使用扩展的预览功能来渲染图表

您也可以在GitHub上查看图表，GitHub具有内置的Mermaid渲染支持。

## 颜色方案

图表使用高对比度颜色方案以提高可见性：
- 粉色（#ff0066）：全局状态和秘密存储组件
- 蓝色（#0066ff）：扩展状态上下文
- 绿色（#00cc66）：Cline提供者
- 所有组件使用白色文本以最大化可读性