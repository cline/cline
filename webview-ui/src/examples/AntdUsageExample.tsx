import type { DatePickerProps } from "antd"
import { Button, Card, Col, DatePicker, Form, Input, Modal, message, Row, Select, Space, Switch, Typography } from "antd"
import React, { useState } from "react"

const { Title, Text } = Typography
const { Option } = Select

const AntdUsageExample: React.FC = () => {
	const [loading, setLoading] = useState(false)
	const [modalVisible, setModalVisible] = useState(false)
	const [form] = Form.useForm()

	const handleClick = () => {
		setLoading(true)
		setTimeout(() => {
			setLoading(false)
			message.success("操作成功!")
		}, 2000)
	}

	const handleFinish = (values: any) => {
		console.log("表单值:", values)
		message.success("表单提交成功!")
		setModalVisible(false)
	}

	const handleDateChange: DatePickerProps["onChange"] = (date, dateString) => {
		console.log(date, dateString)
	}

	return (
		<div className="p-4">
			<Card style={{ maxWidth: 800, margin: "0 auto" }} title="Ant Design 使用示例">
				<Space direction="vertical" size="large" style={{ width: "100%" }}>
					<div>
						<Title level={4}>基础组件</Title>
						<Space wrap>
							<Button loading={loading} onClick={handleClick} type="primary">
								加载按钮
							</Button>
							<Button onClick={() => setModalVisible(true)}>打开表单模态框</Button>
							<Switch defaultChecked />
							<Text>开关状态</Text>
						</Space>
					</div>

					<div>
						<Title level={4}>表单组件</Title>
						<Row gutter={16}>
							<Col span={12}>
								<Input placeholder="用户名" />
							</Col>
							<Col span={12}>
								<DatePicker onChange={handleDateChange} placeholder="选择日期" style={{ width: "100%" }} />
							</Col>
						</Row>
					</div>

					<div>
						<Title level={4}>选择器</Title>
						<Select allowClear placeholder="选择选项" style={{ width: 200 }}>
							<Option value="react">React</Option>
							<Option value="vue">Vue</Option>
							<Option value="angular">Angular</Option>
						</Select>
					</div>
				</Space>
			</Card>

			<Modal footer={null} onCancel={() => setModalVisible(false)} open={modalVisible} title="示例表单">
				<Form form={form} layout="vertical" onFinish={handleFinish}>
					<Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名!" }]}>
						<Input placeholder="请输入用户名" />
					</Form.Item>

					<Form.Item
						label="邮箱"
						name="email"
						rules={[
							{ required: true, message: "请输入邮箱!" },
							{ type: "email", message: "请输入有效的邮箱地址!" },
						]}>
						<Input placeholder="请输入邮箱" />
					</Form.Item>

					<Form.Item label="前端框架" name="framework" rules={[{ required: true, message: "请选择前端框架!" }]}>
						<Select placeholder="请选择前端框架">
							<Option value="react">React</Option>
							<Option value="vue">Vue</Option>
							<Option value="angular">Angular</Option>
						</Select>
					</Form.Item>

					<Form.Item>
						<Space>
							<Button htmlType="submit" type="primary">
								提交
							</Button>
							<Button onClick={() => setModalVisible(false)}>取消</Button>
						</Space>
					</Form.Item>
				</Form>
			</Modal>
		</div>
	)
}

export default AntdUsageExample
