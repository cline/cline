#!/usr/bin/env node

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { globby } from "globby"

const PROTO_DIR = path.resolve("proto")
const typeNameToFQN = new Map()

function addTypeNameToFqn(name, fqn) {
	if (typeNameToFQN.has(name) && typeNameToFQN.get(name) !== fqn) {
		throw new Error(`Proto type ${name} redefined (${fqn}).`)
	}
	typeNameToFQN.set(name, fqn)
}

export function getFqn(name) {
	const shortName = name.split(".").filter(Boolean).at(-1)
	const fqn = shortName ? typeNameToFQN.get(shortName) : undefined
	if (!fqn) {
		throw new Error(`No FQN for ${name}`)
	}
	return fqn
}

function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function parseServiceMethods(body) {
	const methods = {}
	const rpcPattern = /rpc\s+(\w+)\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*;/g
	for (const match of body.matchAll(rpcPattern)) {
		methods[match[1]] = {
			requestType: { type: { name: match[3] } },
			responseType: { type: { name: match[5] } },
			requestStream: Boolean(match[2]),
			responseStream: Boolean(match[4]),
		}
	}
	return methods
}

export async function loadServicesFromProtoDescriptor() {
	typeNameToFQN.clear()
	const sources = []
	const protoFiles = await globby("**/*.proto", { cwd: PROTO_DIR, absolute: true })

	for (const protoFile of protoFiles) {
		const source = stripComments(await fs.readFile(protoFile, "utf8"))
		const packageName = /\bpackage\s+([\w.]+)\s*;/.exec(source)?.[1]
		if (!packageName) {
			throw new Error(`Proto package is missing in ${protoFile}`)
		}
		for (const match of source.matchAll(/\b(?:message|enum)\s+(\w+)\s*\{/g)) {
			addTypeNameToFqn(match[1], `proto.${packageName}.${match[1]}`)
		}
		sources.push({ packageName, source })
	}

	const servicesByPackage = { cline: {}, host: {} }
	for (const { packageName, source } of sources) {
		const packageServices = servicesByPackage[packageName]
		if (!packageServices) {
			continue
		}
		for (const match of source.matchAll(/\bservice\s+(\w+)\s*\{([\s\S]*?)\}/g)) {
			packageServices[match[1]] = { service: parseServiceMethods(match[2]) }
		}
	}

	return {
		protobusServices: servicesByPackage.cline,
		hostServices: servicesByPackage.host,
	}
}
