# Ant Design 集成指南

本文档说明了如何在 Cline 项目的 webview-ui 中集成和使用 Ant Design 组件库。

## 安装

Ant Design 已经通过以下命令安装到项目中：

```bash
npm install antd
```

## 配置

### 1. 主题配置

在 [Providers.tsx](file:///devdata/code/cline-can/cline/webview-ui/src/Providers.tsx) 中配置了 Ant Design 的主题，使其适配 VS Code 的主题颜色：

```typescript
import { ConfigProvider } from "antd"

const antdTheme = {
  token: {
    colorPrimary: '#007acc', // VS Code 主色调
    colorBgContainer: 'var(--vscode-editor-background)',
    colorBgElevated: 'var(--vscode-sideBar-background)',
    colorText: 'var(--vscode-foreground)',
    colorTextSecondary: 'var(--vscode-descriptionForeground)',
    colorBorder: 'var(--vscode-focusBorder)',
    colorFillAlter: 'var(--vscode-sideBar-background)',
    borderRadius: 4,
  },
  components: {
    // 组件特定的样式配置
  },
}

export const Providers = ({ children }: ProvidersProps) => {
  return (
    <ConfigProvider theme={antdTheme}>
      {children}
    </ConfigProvider>
  )
}
```

### 2. 按需导入

推荐使用按需导入的方式来引入 Ant Design 组件，以减小打包体积：

```typescript
import { Button, Space, Card } from 'antd'
```

## 使用示例

### 基础使用

```typescript
import React from 'react'
import { Button, Space, Card } from 'antd'

const MyComponent: React.FC = () => {
  return (
    <Card title="示例卡片">
      <Space>
        <Button type="primary">主要按钮</Button>
        <Button>默认按钮</Button>
      </Space>
    </Card>
  )
}

export default MyComponent
```

### 表单使用

```typescript
import React from 'react'
import { Form, Input, Button, message } from 'antd'

const MyForm: React.FC = () => {
  const [form] = Form.useForm()
  
  const onFinish = (values: any) => {
    console.log('表单值:', values)
    message.success('提交成功!')
  }
  
  return (
    <Form form={form} onFinish={onFinish}>
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true }]}
      >
        <Input />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit">
          提交
        </Button>
      </Form.Item>
    </Form>
  )
}
```

## 注意事项

1. **样式冲突**：Ant Design 的样式可能与现有的 Tailwind CSS 和 VS Code Webview UI Toolkit 样式产生冲突，需要适当调整。

2. **主题适配**：已配置主题以适配 VS Code 的颜色变量，但某些组件可能需要额外的样式调整。

3. **按需加载**：为了优化性能，请只导入实际使用的组件。

4. **TypeScript 支持**：Ant Design 提供了完整的 TypeScript 类型定义，可提供良好的开发体验。

## 可用组件

以下是一些常用的 Ant Design 组件：

- 基础：Button, Icon, Typography
- 布局：Space, Divider, Grid
- 导航：Menu, Tabs, Breadcrumb
- 数据录入：Input, Select, DatePicker, Form
- 数据展示：Card, Table, List, Descriptions
- 反馈：Modal, message, notification, Progress
- 其他：ConfigProvider, Affix

详细组件文档请参考 [Ant Design 官方文档](https://ant.design/components/overview/)。

## 测试组件

项目中提供了测试组件以验证集成是否成功：

1. [AntdExample.tsx](file:///devdata/code/cline-can/cline/webview-ui/src/examples/AntdExample.tsx) - 基础组件示例
2. [AntdUsageExample.tsx](file:///devdata/code/cline-can/cline/webview-ui/src/examples/AntdUsageExample.tsx) - 高级用法示例
3. [AntdTestPage.tsx](file:///devdata/code/cline-can/cline/webview-ui/src/components/common/AntdTestPage.tsx) - 测试页面

可以通过在 [App.tsx](file:///devdata/code/cline-can/cline/webview-ui/src/App.tsx) 中取消注释相应组件来查看效果。