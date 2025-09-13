import os from "os"
import path from "path"

export const DEFAULT_IDCS_CLIENT_ID = "a8331954c0cf48ba99b5dd223a14c6ea"
export const DEFAULT_IDCS_URL = "https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com"
export const DEFAULT_IDSC_SCOPES = "openid offline_access"
export const OCA_CONFIG_PATH = path.join(os.homedir(), ".oca", "config.json")
export const DEFAULT_OCA_BASE_URL = "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm"
export const OCI_HEADER_OPC_REQUEST_ID = "opc-request-id"
export const DEFAULT_IDCS_PORT_CANDIDATES = [8669, 8668, 8667]
