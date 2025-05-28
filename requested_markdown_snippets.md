### 场景：将模型图或设计稿转换为功能性应用程序。
例如，您可以要求 Cline 根据一个简单的 Element Plus 表单设计图（或文字描述）快速生成 Vue3 组件的基础代码。

**Vue3 + Element Plus + Vite 演示案例：**
*   **示例提示给 Cline**：
    ```markdown
    我需要一个新的 Vue3 组件 `UserProfileForm.vue` 用于编辑用户资料。
    请使用 Element Plus 组件库实现以下功能：
    1. 一个用于输入“用户名”的 `el-input`，标签为“用户名”。
    2. 一个用于输入“邮箱”的 `el-input`，标签为“邮箱”。
    3. 一个 `el-date-picker` 用于选择“生日”，标签为“生日”。
    4. 一个 `el-button`，文本为“更新资料”，类型为 primary，点击时执行 `handleSubmit` 方法。
    请在 `<script setup>` 中定义 `handleSubmit` 方法，目前只需在控制台打印表单数据。
    同时，为表单数据创建一个响应式对象。
    ```

---

### 场景：自动化常见的开发任务。
例如，Cline 可以帮助您执行项目脚本、安装依赖或创建项目文件结构。

**Vue3 + Element Plus + Vite 演示案例：**
*   **示例提示给 Cline (安装依赖并创建服务文件)**：
    ```markdown
    请帮我完成以下操作：
    1. 在当前 Vue3 + Vite 项目的根目录下执行 `npm install axios --save`。
    2. 在 `src/` 目录下创建一个名为 `utils` 的新文件夹（如果它还不存在）。
    3. 在 `src/utils/` 目录下创建一个新文件 `request.js`。
    4. 在 `request.js` 文件中，导入 `axios`，创建一个 axios 实例并配置基础URL为 `/api`，然后导出该实例。
    ```
*   **示例提示给 Cline (快速启动开发服务器)**：
    ```markdown
    请在 VSCode 的集成终端中执行 `npm run dev` 命令来启动 Vite 开发服务器。
    ```

---

### 场景：在大型或不熟悉的代码项目中提供开发辅助。
当您接触一个复杂的 Vue3 项目时，可以利用 Cline 快速理解代码，例如某个 Pinia store 模块的结构和用法。

**Vue3 + Element Plus + Vite 演示案例：**
*   **示例提示给 Cline (理解Pinia store模块)**：
    ```markdown
    我正在学习这个项目中的 `src/stores/cartStore.js` (这是一个 Pinia store)。
    请帮我分析这个文件：
    1. 它的 state 中包含哪些主要数据？
    2. 它有哪些主要的 getters，分别用来计算什么？
    3. 它有哪些主要的 actions，分别用来处理什么逻辑？
    4. 我应该如何在 Vue 组件的 `<script setup>` 中导入并使用这个 store 的 state 和 actions？请给一个简单的例子。
    ```

---

### 场景：进行 Web 应用的端到端测试。
*(注意：此功能依赖于 Cline 是否具备实际的浏览器控制能力，如通过集成相关工具或协议实现。)*

如果 Cline 具备浏览器操作能力，您可以指示它执行简单的端到端测试流程，例如测试用户登录。

**Vue3 + Element Plus + Vite 演示案例：**
*   **示例提示给 Cline (测试用户登录流程)**：
    ```markdown
    我想测试一下我们 Vue3 应用的登录流程：
    1. 启动一个新的浏览器窗口并导航到应用的登录页面 (URL是 `/login`)。
    2. 在 `el-input[placeholder="用户名"]` 的输入框中输入 `testUser`。
    3. 在 `el-input[type="password"]` 的输入框中输入 `P@$$wOrd`。
    4. 点击包含文本 “登录” 的 `el-button`。
    5. 等待页面跳转，然后检查当前页面的 URL 是否变为 `/dashboard`。
    6. 截取当前浏览器窗口的屏幕快照并保存。
    ```
