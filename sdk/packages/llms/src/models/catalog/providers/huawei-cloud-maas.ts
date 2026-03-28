/**
 * Huawei Cloud MaaS Provider
 */

import type { ModelCollection } from "../../types/index";

export const HUAWEI_CLOUD_MAAS_PROVIDER: ModelCollection = {
	provider: {
		id: "huawei-cloud-maas",
		name: "Huawei Cloud MaaS",
		description: "Huawei's model-as-a-service platform",
		protocol: "openai-chat",
		baseUrl: "https://infer-modelarts.cn-southwest-2.myhuaweicloud.com/v1",
		defaultModelId: "DeepSeek-R1",
		env: ["HUAWEI_CLOUD_MAAS_API_KEY"],
	},
	models: {},
};
