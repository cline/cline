# Building MCP Servers from GitHub Repositories

This guide provides a step-by-step walkthrough of how to use Cline to build an existing MCP server from a GitHub repository.

## **Finding an MCP Server**

There are multiple places online to find MCP servers:

-   **Cline can automatically add MCP servers to its list, which you can then edit.** Cline can clone repositories directly from GitHub and build the servers for you.
-   **GitHub:** Two of the most common places to find MCP servers on GitHub include:
    -   [Official MCP servers repository](https://github.com/modelcontextprotocol/servers)
    -   [Awesome-MCP servers repository](https://github.com/punkpeye/awesome-mcp-servers)
-   **Online directories:** Several websites list MCP servers including:

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    These directories allow users to sort the servers by various criteria such as downloads, date, stars, and use case. Each entry provides information such as features, tools, and configuration instructions.

-   **PulseMCP:** This website has a blog post discussing how AI could use MCP servers to make websites obsolete. PulseMCP also includes an FAQ section about MCP servers: [https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **Building with Cline**

1.  **Initiate the Process:** Provide Cline with the following information:
    -   **GitHub Repository URL:** The URL of the server's repository.
    -   **README.md Contents:** This is optional but helpful for Cline to understand the server's purpose and configuration. You can copy the README.md file from the GitHub repository.
2.  **Example Interaction with Cline:**

    ```
    User: "Cline, I want to add the MCP server for Brave browser control. Here's the GitHub link: https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search Can you add it?"

    Cline: "OK. Cloning the repository to the MCP directory. It needs to be built because it has a 'package.json' file. Should I run 'npm run build'?"

    User: "Yes, build it."

    Cline: "Build complete. This server needs a browser path. Where's your Brave browser executable?"

    User: "It's in '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'."

    Cline: "OK. I've updated the server config with that path and added it to 'cline_mcp_settings.json'. Anything else?"

    User: "No, that's all. Let's test it."

    Cline: "Great! Starting the MCP Inspector to test the server connection. After that, we can try controlling the browser from Cline."
    ```

3.  **Cline's Actions:** Based on your instructions, Cline will perform the following:
    -   **Repository Cloning:** Cline will clone the repository to your local machine, usually in the directory specified in your configuration.
    -   **Tweaking:** You can guide Cline to modify the server’s configuration. For instance:
        -   **User:** "This server requires an API key. Can you find where it should be added?"
        -   Cline may automatically update the `cline_mcp_settings.json` file or other relevant files based on your instructions.
    -   **Building the Server:** Cline will run the appropriate build command for the server, which is commonly `npm run build`.
    -   **Adding Server to Settings:** Cline will add the server’s configuration to the `cline_mcp_settings.json` file.

## **Testing and Troubleshooting**

1.  **Test the Server:** Once Cline finishes the build process, test the server to make sure it works as expected. Cline can assist you if you encounter any problems.
2.  **MCP Inspector:** You can use the MCP Inspector to test the server’s connection and functionality.

## **Best Practices**

-   **Understand the Basics:** While Cline simplifies the process, it’s beneficial to have a basic understanding of the server’s code, the MCP protocol (), and how to configure the server. This allows for more effective troubleshooting and customization.
-   **Clear Instructions:** Provide clear and specific instructions to Cline throughout the process.
-   **Testing:** Thoroughly test the server after installation and configuration to ensure it functions correctly.
-   **Version Control:** Use a version control system (like Git) to track changes to the server’s code.
-   **Stay Updated:** Keep your MCP servers updated to benefit from the latest features and security patches.
