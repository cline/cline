# AWS Bedrock startup

The VS Code extension validates its AWS connection on activation, discovers
streaming text foundation models and inference profiles from the regional
Bedrock control plane, and probes only the selected destination through the
same streaming runtime used by chat.

Credentials come from the AWS SDK default credential chain or an optional
named profile/SSO session. They are never stored by the extension. The Runtime
endpoint and advanced control-plane endpoint are separate settings; a Runtime
or VPC endpoint is not inferred as a control-plane endpoint. A configured CA
bundle is applied to credential-provider calls, STS, Bedrock discovery, and
Bedrock Runtime.

The AWS identity needs permission for:

```text
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
bedrock:GetInferenceProfile
bedrock:InvokeModel
bedrock:InvokeModelWithResponseStream
```

STS `GetCallerIdentity` is also called during startup to distinguish invalid or
expired credentials from Bedrock authorization failures. Only a masked account
identifier may be displayed for the current extension session.
