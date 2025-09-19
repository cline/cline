---
"claude-dev": minor
---

Add Oracle Code Assist (oca) AI as a provider with necessary API, configuration, and UI updates.
Behavior:
* Oracle Code Assist (OCA) is implemented via SSO / Oauth with an IDCS provider for ouath.
* Adds oca  as a new API provider in proto/models.proto and proto/state.proto.
* Adds oca model refresh in proto/models.
* Adds oca service in proto/oca for login, logout and refresh.
* Implements Ocahandler (Extension of LiteLlmHandler) in src/api/providers/moonshot.ts to handle API interactions.
* Updates createHandlerForProvider() in src/api/index.ts to include Ocahandler.

Configuration:
* Adds ocaAccessKey and other necessary fields to ApiConfiguration in src/shared/api.ts and src/core/storage/state.ts.
* Updates convertApiConfigurationToProto() and convertProtoToApiConfiguration() in src/shared/proto-conversions/models/api-configuration-conversion.ts to handle oca provider fields.

UI:
* Adds OcaProvider component in webview-ui/src/components/settings/providers/OcaProvider.tsx along with OcaModelPicker.tsx component.
* Updates ApiOptions in webview-ui/src/components/settings/ApiOptions.tsx to include oca in the provider dropdown.
* Validates ocaAccessKey in webview-ui/src/utils/validate.ts.
