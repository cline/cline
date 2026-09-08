const { DeploymentApi } = require("@sap-ai-sdk/ai-api");

async function run() {
	const destination = {
		url: "https://api.ai.example.aws.ml.hana.ondemand.com",
		authentication: "OAuth2ClientCredentials",
		clientId: "dummy-client-id",
		clientSecret: "dummy-client-secret",
		tokenServiceUrl:
			"https://example.authentication.sap.hana.ondemand.com/oauth/token",
	};

	try {
		console.log("Querying deployments...");
		const response = await DeploymentApi.deploymentQuery(
			{},
			{
				"AI-Resource-Group": "default",
			},
		).execute(destination);
		console.log("Success:", response);
	} catch (error) {
		console.error("Error occurred:");
		console.error(error);
		if (error.cause) {
			console.error("Cause:", error.cause);
		}
	}
}

run();
