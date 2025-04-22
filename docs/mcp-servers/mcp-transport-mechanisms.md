# MCP Transport Mechanisms

Model Context Protocol (MCP) supports two primary transport mechanisms for communication between Cline and MCP servers: Standard Input/Output (STDIO) and Server-Sent Events (SSE). Each has distinct characteristics, advantages, and use cases.

### STDIO Transport[​](https://docs.roocode.com/features/mcp/server-transports#stdio-transport) <a href="#stdio-transport" id="stdio-transport"></a>

STDIO transport runs locally on your machine and communicates via standard input/output streams.

#### How STDIO Transport Works[​](https://docs.roocode.com/features/mcp/server-transports#how-stdio-transport-works) <a href="#how-stdio-transport-works" id="how-stdio-transport-works"></a>

1. The client (Cline) spawns an MCP server as a child process
2. Communication happens through process streams: client writes to server's STDIN, server responds to STDOUT
3. Each message is delimited by a newline character
4. Messages are formatted as JSON-RPC 2.0

```
Client                    Server
  |                         |
  |<---- JSON message ----->| (via STDIN)
  |                         | (processes request)
  |<---- JSON message ------| (via STDOUT)
  |                         |
```

#### STDIO Characteristics[​](https://docs.roocode.com/features/mcp/server-transports#stdio-characteristics) <a href="#stdio-characteristics" id="stdio-characteristics"></a>

* **Locality**: Runs on the same machine as Cline
* **Performance**: Very low latency and overhead (no network stack involved)
* **Simplicity**: Direct process communication without network configuration
* **Relationship**: One-to-one relationship between client and server
* **Security**: Inherently more secure as no network exposure

#### When to Use STDIO[​](https://docs.roocode.com/features/mcp/server-transports#when-to-use-stdio) <a href="#when-to-use-stdio" id="when-to-use-stdio"></a>

STDIO transport is ideal for:

* Local integrations and tools running on the same machine
* Security-sensitive operations
* Low-latency requirements
* Single-client scenarios (one Cline instance per server)
* Command-line tools or IDE extensions

#### STDIO Implementation Example[​](https://docs.roocode.com/features/mcp/server-transports#stdio-implementation-example) <a href="#stdio-implementation-example" id="stdio-implementation-example"></a>

```
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({name: 'local-server', version: '1.0.0'});
// Register tools...

// Use STDIO transport
const transport = new StdioServerTransport(server);
transport.listen();
```

### SSE Transport[​](https://docs.roocode.com/features/mcp/server-transports#sse-transport) <a href="#sse-transport" id="sse-transport"></a>

Server-Sent Events (SSE) transport runs on a remote server and communicates over HTTP/HTTPS.

#### How SSE Transport Works[​](https://docs.roocode.com/features/mcp/server-transports#how-sse-transport-works) <a href="#how-sse-transport-works" id="how-sse-transport-works"></a>

1. The client (Cline) connects to the server's SSE endpoint via HTTP GET request
2. This establishes a persistent connection where the server can push events to the client
3. For client-to-server communication, the client makes HTTP POST requests to a separate endpoint
4. Communication happens over two channels:
   * Event Stream (GET): Server-to-client updates
   * Message Endpoint (POST): Client-to-server requests

```
Client                             Server
  |                                  |
  |---- HTTP GET /events ----------->| (establish SSE connection)
  |<---- SSE event stream -----------| (persistent connection)
  |                                  |
  |---- HTTP POST /message --------->| (client request)
  |<---- SSE event with response ----| (server response)
  |                                  |
```

#### SSE Characteristics[​](https://docs.roocode.com/features/mcp/server-transports#sse-characteristics) <a href="#sse-characteristics" id="sse-characteristics"></a>

* **Remote Access**: Can be hosted on a different machine from your Cline instance
* **Scalability**: Can handle multiple client connections concurrently
* **Protocol**: Works over standard HTTP (no special protocols needed)
* **Persistence**: Maintains a persistent connection for server-to-client messages
* **Authentication**: Can use standard HTTP authentication mechanisms

#### When to Use SSE[​](https://docs.roocode.com/features/mcp/server-transports#when-to-use-sse) <a href="#when-to-use-sse" id="when-to-use-sse"></a>

SSE transport is better for:

* Remote access across networks
* Multi-client scenarios
* Public services
* Centralized tools that many users need to access
* Integration with web services

#### SSE Implementation Example[​](https://docs.roocode.com/features/mcp/server-transports#sse-implementation-example) <a href="#sse-implementation-example" id="sse-implementation-example"></a>

```
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

const app = express();
const server = new Server({name: 'remote-server', version: '1.0.0'});
// Register tools...

// Use SSE transport
const transport = new SSEServerTransport(server);
app.use('/mcp', transport.requestHandler());
app.listen(3000, () => {
  console.log('MCP server listening on port 3000');
});
```

### Local vs. Hosted: Deployment Aspects[​](https://docs.roocode.com/features/mcp/server-transports#local-vs-hosted-deployment-aspects) <a href="#local-vs-hosted-deployment-aspects" id="local-vs-hosted-deployment-aspects"></a>

The choice between STDIO and SSE transports directly impacts how you'll deploy and manage your MCP servers.

#### STDIO: Local Deployment Model[​](https://docs.roocode.com/features/mcp/server-transports#stdio-local-deployment-model) <a href="#stdio-local-deployment-model" id="stdio-local-deployment-model"></a>

STDIO servers run locally on the same machine as Cline, which has several important implications:

* **Installation**: The server executable must be installed on each user's machine
* **Distribution**: You need to provide installation packages for different operating systems
* **Updates**: Each instance must be updated separately
* **Resources**: Uses the local machine's CPU, memory, and disk
* **Access Control**: Relies on the local machine's filesystem permissions
* **Integration**: Easy integration with local system resources (files, processes)
* **Execution**: Starts and stops with Cline (child process lifecycle)
* **Dependencies**: Any dependencies must be installed on the user's machine

**Practical Example**[**​**](https://docs.roocode.com/features/mcp/server-transports#practical-example)

A local file search tool using STDIO would:

* Run on the user's machine
* Have direct access to the local filesystem
* Start when needed by Cline
* Not require network configuration
* Need to be installed alongside Cline or via a package manager

#### SSE: Hosted Deployment Model[​](https://docs.roocode.com/features/mcp/server-transports#sse-hosted-deployment-model) <a href="#sse-hosted-deployment-model" id="sse-hosted-deployment-model"></a>

SSE servers can be deployed to remote servers and accessed over the network:

* **Installation**: Installed once on a server, accessed by many users
* **Distribution**: Single deployment serves multiple clients
* **Updates**: Centralized updates affect all users immediately
* **Resources**: Uses server resources, not local machine resources
* **Access Control**: Managed through authentication and authorization systems
* **Integration**: More complex integration with user-specific resources
* **Execution**: Runs as an independent service (often continuously)
* **Dependencies**: Managed on the server, not on user machines

**Practical Example**[**​**](https://docs.roocode.com/features/mcp/server-transports#practical-example-1)

A database query tool using SSE would:

* Run on a central server
* Connect to databases with server-side credentials
* Be continuously available for multiple users
* Require proper network security configuration
* Be deployed using container or cloud technologies

#### Hybrid Approaches[​](https://docs.roocode.com/features/mcp/server-transports#hybrid-approaches) <a href="#hybrid-approaches" id="hybrid-approaches"></a>

Some scenarios benefit from a hybrid approach:

1. **STDIO with Network Access**: A local STDIO server that acts as a proxy to remote services
2. **SSE with Local Commands**: A remote SSE server that can trigger operations on the client machine through callbacks
3. **Gateway Pattern**: STDIO servers for local operations that connect to SSE servers for specialized functions

### Choosing Between STDIO and SSE[​](https://docs.roocode.com/features/mcp/server-transports#choosing-between-stdio-and-sse) <a href="#choosing-between-stdio-and-sse" id="choosing-between-stdio-and-sse"></a>

| Consideration        | STDIO                    | SSE                                 |
| -------------------- | ------------------------ | ----------------------------------- |
| **Location**         | Local machine only       | Local or remote                     |
| **Clients**          | Single client            | Multiple clients                    |
| **Performance**      | Lower latency            | Higher latency (network overhead)   |
| **Setup Complexity** | Simpler                  | More complex (requires HTTP server) |
| **Security**         | Inherently secure        | Requires explicit security measures |
| **Network Access**   | Not needed               | Required                            |
| **Scalability**      | Limited to local machine | Can distribute across network       |
| **Deployment**       | Per-user installation    | Centralized installation            |
| **Updates**          | Distributed updates      | Centralized updates                 |
| **Resource Usage**   | Uses client resources    | Uses server resources               |
| **Dependencies**     | Client-side dependencies | Server-side dependencies            |

### Configuring Transports in Cline[​](https://docs.roocode.com/features/mcp/server-transports#configuring-transports-in-roo-code) <a href="#configuring-transports-in-roo-code" id="configuring-transports-in-roo-code"></a>

For detailed information on configuring STDIO and SSE transports in Cline, including examples, [see Configuring MCP Servers](configuring-mcp-servers.md).

\
