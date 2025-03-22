<div align="center">
<sub>

English • [Català](locales/ca/README.md) • [Deutsch](locales/de/README.md) • [Español](locales/es/README.md) • [Français](locales/fr/README.md) • [हिन्दी](locales/hi/README.md) • [Italiano](locales/it/README.md)

</sub>
<sub>

[日本語](locales/ja/README.md) • [한국어](locales/ko/README.md) • [Polski](locales/pl/README.md) • [Português (BR)](locales/pt-BR/README.md) • [Türkçe](locales/tr/README.md) • [Tiếng Việt](locales/vi/README.md) • [简体中文](locales/zh-CN/README.md) • [繁體中文](locales/zh-TW/README.md)

</sub>
</div>
<br>

<div align="center">
  <h2>Join the Roo Code Community</h2>
  <p>Connect with developers, contribute ideas, and stay ahead with the latest AI-powered coding tools.</p>
  
  <a href="https://discord.gg/roocode" target="_blank"><img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord"></a>
  <a href="https://www.reddit.com/r/RooCode/" target="_blank"><img src="https://img.shields.io/badge/Join%20Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white" alt="Join Reddit"></a>
  
</div>
<br>
<br>

<div align="center">
<h1>Roo Code (prev. Roo Cline)</h1>

<a href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline" target="_blank"><img src="https://img.shields.io/badge/Download%20on%20VS%20Marketplace-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Download on VS Marketplace"></a>
<a href="https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><img src="https://img.shields.io/badge/Feature%20Requests-yellow?style=for-the-badge" alt="Feature Requests"></a>
<a href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline&ssr=false#review-details" target="_blank"><img src="https://img.shields.io/badge/Rate%20%26%20Review-green?style=for-the-badge" alt="Rate & Review"></a>
<a href="https://docs.roocode.com" target="_blank"><img src="https://img.shields.io/badge/Documentation-6B46C1?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation"></a>

</div>

**Roo Code** is an AI-powered **autonomous coding agent** that lives in your editor. It can:

- Communicate in natural language
- Read and write files directly in your workspace
- Run terminal commands
- Automate browser actions
- Integrate with any OpenAI-compatible or custom API/model
- Adapt its “personality” and capabilities through **Custom Modes**

Whether you’re seeking a flexible coding partner, a system architect, or specialized roles like a QA engineer or product manager, Roo Code can help you build software more efficiently.

Check out the [CHANGELOG](CHANGELOG.md) for detailed updates and fixes.

---

## 🎉 Roo Code 3.10 Released

Roo Code 3.10 brings powerful productivity enhancements!

- Suggested responses to questions to save you time typing
- Improved large file handling through mapping out the file structure and reading only the relevant content
- Rebuilt @-mention file lookup that respects .gitignore and doesn't have a limit on the number of files tracked

---

## What Can Roo Code Do?

- 🚀 **Generate Code** from natural language descriptions
- 🔧 **Refactor & Debug** existing code
- 📝 **Write & Update** documentation
- 🤔 **Answer Questions** about your codebase
- 🔄 **Automate** repetitive tasks
- 🏗️ **Create** new files and projects

## Quick Start

1. [Install Roo Code](https://docs.roocode.com/getting-started/installing)
2. [Connect Your AI Provider](https://docs.roocode.com/getting-started/connecting-api-provider)
3. [Try Your First Task](https://docs.roocode.com/getting-started/your-first-task)

## Key Features

### Multiple Modes

Roo Code adapts to your needs with specialized [modes](https://docs.roocode.com/basic-usage/modes):

- **Code Mode:** For general-purpose coding tasks
- **Architect Mode:** For planning and technical leadership
- **Ask Mode:** For answering questions and providing information
- **Debug Mode:** For systematic problem diagnosis
- **[Custom Modes](https://docs.roocode.com/advanced-usage/custom-modes):** Create unlimited specialized personas for security auditing, performance optimization, documentation, or any other task

### Smart Tools

Roo Code comes with powerful [tools](https://docs.roocode.com/basic-usage/using-tools) that can:

- Read and write files in your project
- Execute commands in your VS Code terminal
- Control a web browser
- Use external tools via [MCP (Model Context Protocol)](https://docs.roocode.com/advanced-usage/mcp)

MCP extends Roo Code's capabilities by allowing you to add unlimited custom tools. Integrate with external APIs, connect to databases, or create specialized development tools - MCP provides the framework to expand Roo Code's functionality to meet your specific needs.

### Customization

Make Roo Code work your way with:

- [Custom Instructions](https://docs.roocode.com/advanced-usage/custom-instructions) for personalized behavior
- [Custom Modes](https://docs.roocode.com/advanced-usage/custom-modes) for specialized tasks
- [Local Models](https://docs.roocode.com/advanced-usage/local-models) for offline use
- [Auto-Approval Settings](https://docs.roocode.com/advanced-usage/auto-approving-actions) for faster workflows

## Resources

### Documentation

- [Basic Usage Guide](https://docs.roocode.com/basic-usage/the-chat-interface)
- [Advanced Features](https://docs.roocode.com/advanced-usage/auto-approving-actions)
- [Frequently Asked Questions](https://docs.roocode.com/faq)

### Community

- **Discord:** [Join our Discord server](https://discord.gg/roocode) for real-time help and discussions
- **Reddit:** [Visit our subreddit](https://www.reddit.com/r/RooCode) to share experiences and tips
- **GitHub:** Report [issues](https://github.com/RooVetGit/Roo-Code/issues) or request [features](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)

---

## Local Setup & Development

1. **Clone** the repo:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Install dependencies**:

```sh
npm run install:all
```

3. **Start the webview (Vite/React app with HMR)**:

```sh
npm run dev
```

4. **Debug**:
   Press `F5` (or **Run** → **Start Debugging**) in VSCode to open a new session with Roo Code loaded.

Changes to the webview will appear immediately. Changes to the core extension will require a restart of the extension host.

Alternatively you can build a .vsix and install it directly in VSCode:

```sh
npm run build
```

A `.vsix` file will appear in the `bin/` directory which can be installed with:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

We use [changesets](https://github.com/changesets/changesets) for versioning and publishing. Check our `CHANGELOG.md` for release notes.

---

## Disclaimer

**Please note** that Roo Veterinary, Inc does **not** make any representations or warranties regarding any code, models, or other tools provided or made available in connection with Roo Code, any associated third-party tools, or any resulting outputs. You assume **all risks** associated with the use of any such tools or outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis. Such risks may include, without limitation, intellectual property infringement, cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses, downtime, property loss or damage, and/or personal injury. You are solely responsible for your use of any such tools or outputs (including, without limitation, the legality, appropriateness, and results thereof).

---

## Contributing

We love community contributions! Get started by reading our [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Contributors

Thanks to all our contributors who have helped make Roo Code better!

<!-- START CONTRIBUTORS SECTION - AUTO-GENERATED, DO NOT EDIT MANUALLY -->

|         <a href="https://github.com/mrubens"><img src="https://avatars.githubusercontent.com/u/2600?v=4" width="100" height="100" alt="mrubens"/><br /><sub><b>mrubens</b></sub></a>         |         <a href="https://github.com/saoudrizwan"><img src="https://avatars.githubusercontent.com/u/7799382?v=4" width="100" height="100" alt="saoudrizwan"/><br /><sub><b>saoudrizwan</b></sub></a>         |                    <a href="https://github.com/cte"><img src="https://avatars.githubusercontent.com/u/16332?v=4" width="100" height="100" alt="cte"/><br /><sub><b>cte</b></sub></a>                     |         <a href="https://github.com/samhvw8"><img src="https://avatars.githubusercontent.com/u/12538214?v=4" width="100" height="100" alt="samhvw8"/><br /><sub><b>samhvw8</b></sub></a>         |       <a href="https://github.com/daniel-lxs"><img src="https://avatars.githubusercontent.com/u/57051444?v=4" width="100" height="100" alt="daniel-lxs"/><br /><sub><b>daniel-lxs</b></sub></a>        |                   <a href="https://github.com/a8trejo"><img src="https://avatars.githubusercontent.com/u/62401433?v=4" width="100" height="100" alt="a8trejo"/><br /><sub><b>a8trejo</b></sub></a>                    |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|  <a href="https://github.com/ColemanRoo"><img src="https://avatars.githubusercontent.com/u/117104599?v=4" width="100" height="100" alt="ColemanRoo"/><br /><sub><b>ColemanRoo</b></sub></a>  |             <a href="https://github.com/stea9499"><img src="https://avatars.githubusercontent.com/u/4163795?v=4" width="100" height="100" alt="stea9499"/><br /><sub><b>stea9499</b></sub></a>              |      <a href="https://github.com/joemanley201"><img src="https://avatars.githubusercontent.com/u/8299960?v=4" width="100" height="100" alt="joemanley201"/><br /><sub><b>joemanley201</b></sub></a>      |      <a href="https://github.com/System233"><img src="https://avatars.githubusercontent.com/u/20336040?v=4" width="100" height="100" alt="System233"/><br /><sub><b>System233</b></sub></a>      |       <a href="https://github.com/nissa-seru"><img src="https://avatars.githubusercontent.com/u/119150866?v=4" width="100" height="100" alt="nissa-seru"/><br /><sub><b>nissa-seru</b></sub></a>       |                  <a href="https://github.com/jquanton"><img src="https://avatars.githubusercontent.com/u/88576563?v=4" width="100" height="100" alt="jquanton"/><br /><sub><b>jquanton</b></sub></a>                  |
|        <a href="https://github.com/NyxJae"><img src="https://avatars.githubusercontent.com/u/52313587?v=4" width="100" height="100" alt="NyxJae"/><br /><sub><b>NyxJae</b></sub></a>         |             <a href="https://github.com/MuriloFP"><img src="https://avatars.githubusercontent.com/u/50873657?v=4" width="100" height="100" alt="MuriloFP"/><br /><sub><b>MuriloFP</b></sub></a>             |    <a href="https://github.com/hannesrudolph"><img src="https://avatars.githubusercontent.com/u/49103247?v=4" width="100" height="100" alt="hannesrudolph"/><br /><sub><b>hannesrudolph</b></sub></a>    |            <a href="https://github.com/d-oit"><img src="https://avatars.githubusercontent.com/u/6849456?v=4" width="100" height="100" alt="d-oit"/><br /><sub><b>d-oit</b></sub></a>             |          <a href="https://github.com/punkpeye"><img src="https://avatars.githubusercontent.com/u/108313943?v=4" width="100" height="100" alt="punkpeye"/><br /><sub><b>punkpeye</b></sub></a>          |            <a href="https://github.com/monotykamary"><img src="https://avatars.githubusercontent.com/u/1130103?v=4" width="100" height="100" alt="monotykamary"/><br /><sub><b>monotykamary</b></sub></a>             |
|   <a href="https://github.com/lloydchang"><img src="https://avatars.githubusercontent.com/u/1329685?v=4" width="100" height="100" alt="lloydchang"/><br /><sub><b>lloydchang</b></sub></a>   | <a href="https://github.com/vigneshsubbiah16"><img src="https://avatars.githubusercontent.com/u/51325334?v=4" width="100" height="100" alt="vigneshsubbiah16"/><br /><sub><b>vigneshsubbiah16</b></sub></a> |             <a href="https://github.com/Szpadel"><img src="https://avatars.githubusercontent.com/u/1857251?v=4" width="100" height="100" alt="Szpadel"/><br /><sub><b>Szpadel</b></sub></a>              |         <a href="https://github.com/cannuri"><img src="https://avatars.githubusercontent.com/u/91494156?v=4" width="100" height="100" alt="cannuri"/><br /><sub><b>cannuri</b></sub></a>         |        <a href="https://github.com/lupuletic"><img src="https://avatars.githubusercontent.com/u/105351510?v=4" width="100" height="100" alt="lupuletic"/><br /><sub><b>lupuletic</b></sub></a>         | <a href="https://github.com/Smartsheet-JB-Brown"><img src="https://avatars.githubusercontent.com/u/171734120?v=4" width="100" height="100" alt="Smartsheet-JB-Brown"/><br /><sub><b>Smartsheet-JB-Brown</b></sub></a> |
|     <a href="https://github.com/Premshay"><img src="https://avatars.githubusercontent.com/u/28099628?v=4" width="100" height="100" alt="Premshay"/><br /><sub><b>Premshay</b></sub></a>      |              <a href="https://github.com/psv2522"><img src="https://avatars.githubusercontent.com/u/87223770?v=4" width="100" height="100" alt="psv2522"/><br /><sub><b>psv2522</b></sub></a>               |       <a href="https://github.com/olweraltuve"><img src="https://avatars.githubusercontent.com/u/39308405?v=4" width="100" height="100" alt="olweraltuve"/><br /><sub><b>olweraltuve</b></sub></a>       |     <a href="https://github.com/wkordalski"><img src="https://avatars.githubusercontent.com/u/3035587?v=4" width="100" height="100" alt="wkordalski"/><br /><sub><b>wkordalski</b></sub></a>     |               <a href="https://github.com/qdaxb"><img src="https://avatars.githubusercontent.com/u/4157870?v=4" width="100" height="100" alt="qdaxb"/><br /><sub><b>qdaxb</b></sub></a>                |                <a href="https://github.com/feifei325"><img src="https://avatars.githubusercontent.com/u/46489071?v=4" width="100" height="100" alt="feifei325"/><br /><sub><b>feifei325</b></sub></a>                 |
|   <a href="https://github.com/RaySinner"><img src="https://avatars.githubusercontent.com/u/118297374?v=4" width="100" height="100" alt="RaySinner"/><br /><sub><b>RaySinner</b></sub></a>    |       <a href="https://github.com/afshawnlotfi"><img src="https://avatars.githubusercontent.com/u/6283745?v=4" width="100" height="100" alt="afshawnlotfi"/><br /><sub><b>afshawnlotfi</b></sub></a>        |            <a href="https://github.com/emshvac"><img src="https://avatars.githubusercontent.com/u/121588911?v=4" width="100" height="100" alt="emshvac"/><br /><sub><b>emshvac</b></sub></a>             |           <a href="https://github.com/pdecat"><img src="https://avatars.githubusercontent.com/u/318490?v=4" width="100" height="100" alt="pdecat"/><br /><sub><b>pdecat</b></sub></a>            |         <a href="https://github.com/Lunchb0ne"><img src="https://avatars.githubusercontent.com/u/22198661?v=4" width="100" height="100" alt="Lunchb0ne"/><br /><sub><b>Lunchb0ne</b></sub></a>         |          <a href="https://github.com/pugazhendhi-m"><img src="https://avatars.githubusercontent.com/u/132246623?v=4" width="100" height="100" alt="pugazhendhi-m"/><br /><sub><b>pugazhendhi-m</b></sub></a>          |
|         <a href="https://github.com/sammcj"><img src="https://avatars.githubusercontent.com/u/862951?v=4" width="100" height="100" alt="sammcj"/><br /><sub><b>sammcj</b></sub></a>          |                <a href="https://github.com/KJ7LNW"><img src="https://avatars.githubusercontent.com/u/93454819?v=4" width="100" height="100" alt="KJ7LNW"/><br /><sub><b>KJ7LNW</b></sub></a>                |            <a href="https://github.com/dtrugman"><img src="https://avatars.githubusercontent.com/u/2451669?v=4" width="100" height="100" alt="dtrugman"/><br /><sub><b>dtrugman</b></sub></a>            |      <a href="https://github.com/aitoroses"><img src="https://avatars.githubusercontent.com/u/1699368?v=4" width="100" height="100" alt="aitoroses"/><br /><sub><b>aitoroses</b></sub></a>       |          <a href="https://github.com/yt3trees"><img src="https://avatars.githubusercontent.com/u/57471763?v=4" width="100" height="100" alt="yt3trees"/><br /><sub><b>yt3trees</b></sub></a>           |                   <a href="https://github.com/yongjer"><img src="https://avatars.githubusercontent.com/u/54315206?v=4" width="100" height="100" alt="yongjer"/><br /><sub><b>yongjer</b></sub></a>                    |
| <a href="https://github.com/vincentsong"><img src="https://avatars.githubusercontent.com/u/2343574?v=4" width="100" height="100" alt="vincentsong"/><br /><sub><b>vincentsong</b></sub></a>  |                 <a href="https://github.com/eonghk"><img src="https://avatars.githubusercontent.com/u/139964?v=4" width="100" height="100" alt="eonghk"/><br /><sub><b>eonghk</b></sub></a>                 |    <a href="https://github.com/arthurauffray"><img src="https://avatars.githubusercontent.com/u/51604173?v=4" width="100" height="100" alt="arthurauffray"/><br /><sub><b>arthurauffray</b></sub></a>    |           <a href="https://github.com/aheizi"><img src="https://avatars.githubusercontent.com/u/8243770?v=4" width="100" height="100" alt="aheizi"/><br /><sub><b>aheizi</b></sub></a>           |            <a href="https://github.com/heyseth"><img src="https://avatars.githubusercontent.com/u/8293842?v=4" width="100" height="100" alt="heyseth"/><br /><sub><b>heyseth</b></sub></a>             |                  <a href="https://github.com/philfung"><img src="https://avatars.githubusercontent.com/u/1054593?v=4" width="100" height="100" alt="philfung"/><br /><sub><b>philfung</b></sub></a>                   |
|         <a href="https://github.com/napter"><img src="https://avatars.githubusercontent.com/u/6260841?v=4" width="100" height="100" alt="napter"/><br /><sub><b>napter</b></sub></a>         |                      <a href="https://github.com/mdp"><img src="https://avatars.githubusercontent.com/u/2868?v=4" width="100" height="100" alt="mdp"/><br /><sub><b>mdp</b></sub></a>                       |              <a href="https://github.com/jcbdev"><img src="https://avatars.githubusercontent.com/u/17152092?v=4" width="100" height="100" alt="jcbdev"/><br /><sub><b>jcbdev</b></sub></a>               | <a href="https://github.com/GitlyHallows"><img src="https://avatars.githubusercontent.com/u/136527758?v=4" width="100" height="100" alt="GitlyHallows"/><br /><sub><b>GitlyHallows</b></sub></a> |         <a href="https://github.com/benzntech"><img src="https://avatars.githubusercontent.com/u/4044180?v=4" width="100" height="100" alt="benzntech"/><br /><sub><b>benzntech</b></sub></a>          |              <a href="https://github.com/anton-otee"><img src="https://avatars.githubusercontent.com/u/149477749?v=4" width="100" height="100" alt="anton-otee"/><br /><sub><b>anton-otee</b></sub></a>               |
| <a href="https://github.com/moqimoqidea"><img src="https://avatars.githubusercontent.com/u/39821951?v=4" width="100" height="100" alt="moqimoqidea"/><br /><sub><b>moqimoqidea</b></sub></a> |                   <a href="https://github.com/olup"><img src="https://avatars.githubusercontent.com/u/13785588?v=4" width="100" height="100" alt="olup"/><br /><sub><b>olup</b></sub></a>                   |       <a href="https://github.com/lightrabbit"><img src="https://avatars.githubusercontent.com/u/1521765?v=4" width="100" height="100" alt="lightrabbit"/><br /><sub><b>lightrabbit</b></sub></a>        |            <a href="https://github.com/kohii"><img src="https://avatars.githubusercontent.com/u/6891780?v=4" width="100" height="100" alt="kohii"/><br /><sub><b>kohii</b></sub></a>             |          <a href="https://github.com/kinandan"><img src="https://avatars.githubusercontent.com/u/186135699?v=4" width="100" height="100" alt="kinandan"/><br /><sub><b>kinandan</b></sub></a>          |                     <a href="https://github.com/im47cn"><img src="https://avatars.githubusercontent.com/u/67424112?v=4" width="100" height="100" alt="im47cn"/><br /><sub><b>im47cn</b></sub></a>                     |
|        <a href="https://github.com/dqroid"><img src="https://avatars.githubusercontent.com/u/192424994?v=4" width="100" height="100" alt="dqroid"/><br /><sub><b>dqroid</b></sub></a>        |              <a href="https://github.com/dairui1"><img src="https://avatars.githubusercontent.com/u/183250644?v=4" width="100" height="100" alt="dairui1"/><br /><sub><b>dairui1</b></sub></a>              |             <a href="https://github.com/bannzai"><img src="https://avatars.githubusercontent.com/u/10897361?v=4" width="100" height="100" alt="bannzai"/><br /><sub><b>bannzai</b></sub></a>             |         <a href="https://github.com/AMHesch"><img src="https://avatars.githubusercontent.com/u/4777192?v=4" width="100" height="100" alt="AMHesch"/><br /><sub><b>AMHesch</b></sub></a>          |          <a href="https://github.com/mosleyit"><img src="https://avatars.githubusercontent.com/u/189396442?v=4" width="100" height="100" alt="mosleyit"/><br /><sub><b>mosleyit</b></sub></a>          |                  <a href="https://github.com/oprstchn"><img src="https://avatars.githubusercontent.com/u/16177972?v=4" width="100" height="100" alt="oprstchn"/><br /><sub><b>oprstchn</b></sub></a>                  |
|  <a href="https://github.com/philipnext"><img src="https://avatars.githubusercontent.com/u/81944499?v=4" width="100" height="100" alt="philipnext"/><br /><sub><b>philipnext</b></sub></a>   |       <a href="https://github.com/refactorthis"><img src="https://avatars.githubusercontent.com/u/3012240?v=4" width="100" height="100" alt="refactorthis"/><br /><sub><b>refactorthis</b></sub></a>        |     <a href="https://github.com/samir-nimbly"><img src="https://avatars.githubusercontent.com/u/112695483?v=4" width="100" height="100" alt="samir-nimbly"/><br /><sub><b>samir-nimbly</b></sub></a>     |           <a href="https://github.com/shaybc"><img src="https://avatars.githubusercontent.com/u/8535905?v=4" width="100" height="100" alt="shaybc"/><br /><sub><b>shaybc</b></sub></a>           |    <a href="https://github.com/shohei-ihaya"><img src="https://avatars.githubusercontent.com/u/25131938?v=4" width="100" height="100" alt="shohei-ihaya"/><br /><sub><b>shohei-ihaya</b></sub></a>     |            <a href="https://github.com/student20880"><img src="https://avatars.githubusercontent.com/u/74263488?v=4" width="100" height="100" alt="student20880"/><br /><sub><b>student20880</b></sub></a>            |
|   <a href="https://github.com/teddyOOXX"><img src="https://avatars.githubusercontent.com/u/121077180?v=4" width="100" height="100" alt="teddyOOXX"/><br /><sub><b>teddyOOXX</b></sub></a>    |     <a href="https://github.com/PretzelVector"><img src="https://avatars.githubusercontent.com/u/95664360?v=4" width="100" height="100" alt="PretzelVector"/><br /><sub><b>PretzelVector</b></sub></a>      |       <a href="https://github.com/adamwlarson"><img src="https://avatars.githubusercontent.com/u/1392315?v=4" width="100" height="100" alt="adamwlarson"/><br /><sub><b>adamwlarson</b></sub></a>        |           <a href="https://github.com/alarno"><img src="https://avatars.githubusercontent.com/u/4355547?v=4" width="100" height="100" alt="alarno"/><br /><sub><b>alarno</b></sub></a>           | <a href="https://github.com/andreastempsch"><img src="https://avatars.githubusercontent.com/u/117991125?v=4" width="100" height="100" alt="andreastempsch"/><br /><sub><b>andreastempsch</b></sub></a> |                   <a href="https://github.com/Atlogit"><img src="https://avatars.githubusercontent.com/u/86947554?v=4" width="100" height="100" alt="Atlogit"/><br /><sub><b>Atlogit</b></sub></a>                    |
|          <a href="https://github.com/dleen"><img src="https://avatars.githubusercontent.com/u/1297964?v=4" width="100" height="100" alt="dleen"/><br /><sub><b>dleen</b></sub></a>           |            <a href="https://github.com/dbasclpy"><img src="https://avatars.githubusercontent.com/u/139889137?v=4" width="100" height="100" alt="dbasclpy"/><br /><sub><b>dbasclpy</b></sub></a>             | <a href="https://github.com/celestial-vault"><img src="https://avatars.githubusercontent.com/u/58194240?v=4" width="100" height="100" alt="celestial-vault"/><br /><sub><b>celestial-vault</b></sub></a> |         <a href="https://github.com/franekp"><img src="https://avatars.githubusercontent.com/u/9804230?v=4" width="100" height="100" alt="franekp"/><br /><sub><b>franekp</b></sub></a>          |         <a href="https://github.com/DeXtroTip"><img src="https://avatars.githubusercontent.com/u/21011087?v=4" width="100" height="100" alt="DeXtroTip"/><br /><sub><b>DeXtroTip</b></sub></a>         |                     <a href="https://github.com/hesara"><img src="https://avatars.githubusercontent.com/u/1335918?v=4" width="100" height="100" alt="hesara"/><br /><sub><b>hesara</b></sub></a>                      |
|    <a href="https://github.com/eltociear"><img src="https://avatars.githubusercontent.com/u/22633385?v=4" width="100" height="100" alt="eltociear"/><br /><sub><b>eltociear</b></sub></a>    |       <a href="https://github.com/libertyteeth"><img src="https://avatars.githubusercontent.com/u/32841567?v=4" width="100" height="100" alt="libertyteeth"/><br /><sub><b>libertyteeth</b></sub></a>       |    <a href="https://github.com/mamertofabian"><img src="https://avatars.githubusercontent.com/u/7698436?v=4" width="100" height="100" alt="mamertofabian"/><br /><sub><b>mamertofabian</b></sub></a>     | <a href="https://github.com/marvijo-code"><img src="https://avatars.githubusercontent.com/u/82562019?v=4" width="100" height="100" alt="marvijo-code"/><br /><sub><b>marvijo-code</b></sub></a>  |               <a href="https://github.com/Sarke"><img src="https://avatars.githubusercontent.com/u/2719310?v=4" width="100" height="100" alt="Sarke"/><br /><sub><b>Sarke</b></sub></a>                |                       <a href="https://github.com/tgfjt"><img src="https://avatars.githubusercontent.com/u/2628239?v=4" width="100" height="100" alt="tgfjt"/><br /><sub><b>tgfjt</b></sub></a>                       |
|   <a href="https://github.com/vladstudio"><img src="https://avatars.githubusercontent.com/u/914320?v=4" width="100" height="100" alt="vladstudio"/><br /><sub><b>vladstudio</b></sub></a>    | <a href="https://github.com/Yoshino-Yukitaro"><img src="https://avatars.githubusercontent.com/u/67864326?v=4" width="100" height="100" alt="Yoshino-Yukitaro"/><br /><sub><b>Yoshino-Yukitaro</b></sub></a> |               <a href="https://github.com/ashktn"><img src="https://avatars.githubusercontent.com/u/6723913?v=4" width="100" height="100" alt="ashktn"/><br /><sub><b>ashktn</b></sub></a>               |                                                                                                                                                                                                  |                                                                                                                                                                                                        |                                                                                                                                                                                                                       |

<!-- END CONTRIBUTORS SECTION -->

## License

[Apache 2.0 © 2025 Roo Veterinary, Inc.](./LICENSE)

---

**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can’t wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/RooCode/) or [Discord](https://discord.gg/roocode). Happy coding!
