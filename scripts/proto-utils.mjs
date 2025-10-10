#!/usr/bin/env node

import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as fs from "fs/promises"
import * as path from "path"

const DESCRIPTOR_SET = path.resolve("dist-standalone/proto/descriptor_set.pb")

const typeNameToFQN = new Map()

function addTypeNameToFqn(name, fqn) {
	if (typeNameToFQN.has(name) && typeNameToFQN.get(name) !== fqn) {
		throw new Error(`Proto type ${name} redefined (${fqn}).`)
	}
	typeNameToFQN.set(name, fqn)
}
// Get the fully qualified name for a proto type, e.g. getFqn('StringRequest') returns 'cline.StringRequest'
export function getFqn(name) {
	if (!typeNameToFQN.has(name)) {
		throw Error(`No FQN for ${name}`)
	}
	return typeNameToFQN.get(name)
}

export async function getPackageDefinition() {
	const descriptorBuffer = await fs.readFile(DESCRIPTOR_SET)
	const options = { longs: Number } // Encode int64 fields as numbers
	return protoLoader.loadFileDescriptorSetFromBuffer(descriptorBuffer, options)
}

export async function loadProtoDescriptorSet() {
	const packageDefinition = await getPackageDefinition()
	return grpc.loadPackageDefinition(packageDefinition)
}

export async function loadServicesFromProtoDescriptor() {
	const protoFiles = [
		"cline/account.proto",
		"cline/browser.proto",
		"cline/checkpoints.proto",
		"cline/commands.proto",
		"cline/file.proto",
		"cline/mcp.proto",
		"cline/models.proto",
		"cline/slash.proto",
		"cline/state.proto",
		"cline/task.proto",
		"cline/ui.proto",
		"cline/web.proto",
		"cline/matrix.proto", // 添加新的 proto 文件
	]
	// Load service definitions from descriptor set
	const proto = await loadProtoDescriptorSet()

	// Extract host services and proto messages from the proto definition
	const hostServices = {}
	for (const [name, def] of Object.entries(proto.host)) {
		if (def && "service" in def) {
			hostServices[name] = def
		} else {
			addTypeNameToFqn(name, `proto.host.${name}`)
		}
	}
	const protobusServices = {}
	for (const [name, def] of Object.entries(proto.cline)) {
		if (def && "service" in def) {
			protobusServices[name] = def
		} else {
			addTypeNameToFqn(name, `proto.cline.${name}`)
		}
	}
	return { protobusServices, hostServices }
}
