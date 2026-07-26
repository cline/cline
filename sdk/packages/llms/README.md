# @cline/llms

AWS Bedrock inference for Cline agents.

The runtime accepts a Bedrock model ID plus:

- an AWS region;
- an optional named AWS profile;
- an optional HTTPS Bedrock endpoint;
- an optional CA-bundle path.

Credentials come only from the AWS SDK credential-provider chain. The package
does not accept or persist API keys, access keys, secret keys, or session
tokens as configuration.
