import type { DatePickerProps } from "antd"
import { Button, Card, Col, DatePicker, Input, Row, Select, Space, Switch, Typography } from "antd"
import React from "react"

const { Title, Text } = Typography
const { Option } = Select

interface AntdTestPageProps {
	onClose: () => void
}

const AntdTestPage: React.FC<AntdTestPageProps> = ({ onClose }) => {
	const handleDateChange: DatePickerProps["onChange"] = (date, dateString) => {
		console.log(date, dateString)
	}

	return (
		<div className="p-4" style={{ backgroundColor: "var(--vscode-editor-background)", minHeight: "100vh" }}>
			<Card
				extra={<Button onClick={onClose}>关闭</Button>}
				headStyle={{
					backgroundColor: "var(--vscode-sideBar-background)",
					borderBottomColor: "var(--vscode-panel-border)",
				}}
				style={{
					maxWidth: 800,
					margin: "0 auto",
					backgroundColor: "var(--vscode-sideBar-background)",
					borderColor: "var(--vscode-focusBorder)",
				}}
				title="Ant Design 组件测试">
				<Space direction="vertical" size="large" style={{ width: "100%" }}>
					<div>
						<Title level={4} style={{ color: "var(--vscode-foreground)" }}>
							按钮组件
						</Title>
						<Space wrap>
							<Button type="primary">Primary Button</Button>
							<Button>Default Button</Button>
							<Button type="dashed">Dashed Button</Button>
							<Button type="link">Link Button</Button>
							<Button type="text">Text Button</Button>
							<Button danger type="primary">
								Danger Button
							</Button>
						</Space>
					</div>

					<div>
						<Title level={4} style={{ color: "var(--vscode-foreground)" }}>
							输入组件
						</Title>
						<Row gutter={16}>
							<Col span={12}>
								<Input placeholder="基本输入框" />
							</Col>
							<Col span={12}>
								<Input.Password placeholder="密码输入框" />
							</Col>
						</Row>
					</div>

					<div>
						<Title level={4} style={{ color: "var(--vscode-foreground)" }}>
							选择器
						</Title>
						<Space>
							<DatePicker onChange={handleDateChange} placeholder="选择日期" />
							<Select allowClear placeholder="选择选项" style={{ width: 200 }}>
								<Option value="option1">选项 1</Option>
								<Option value="option2">选项 2</Option>
								<Option value="option3">选项 3</Option>
							</Select>
						</Space>
					</div>

					<div>
						<Title level={4} style={{ color: "var(--vscode-foreground)" }}>
							开关和标签
						</Title>
						<Space>
							<Switch defaultChecked />
							<Text style={{ color: "var(--vscode-foreground)" }}>开关示例</Text>
						</Space>
					</div>

					<div>
						<Title level={4} style={{ color: "var(--vscode-foreground)" }}>
							卡片组件
						</Title>
						<Card size="small" style={{ width: 300 }} title="小卡片">
							<p>这是卡片内容</p>
						</Card>
					</div>
				</Space>
			</Card>
		</div>
	)
}

export default AntdTestPage
