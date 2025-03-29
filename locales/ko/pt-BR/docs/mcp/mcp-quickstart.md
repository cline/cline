# 🚀 Guia Rápido do MCP

## ❓ O que é um Servidor MCP?

Pense nos servidores MCP como ajudantes especiais que dão poderes extras ao Cline! Eles permitem que o Cline faça coisas legais como buscar páginas da web ou trabalhar com seus arquivos.

## ⚠️ IMPORTANTE: Requisitos do Sistema

PARE! Antes de prosseguir, você DEVE verificar esses requisitos:

### Software Necessário

-   ✅ Última versão do Node.js (v18 ou mais recente)

    -   Verifique executando: `node --version`
    -   Instale em: <https://nodejs.org/>

-   ✅ Última versão do Python (v3.8 ou mais recente)

    -   Verifique executando: `python --version`
    -   Instale em: <https://python.org/>

-   ✅ Gerenciador de Pacotes UV
    -   Após instalar o Python, execute: `pip install uv`
    -   Verifique com: `uv --version`

❗ Se algum desses comandos falhar ou mostrar versões mais antigas, por favor, instale/atualize antes de continuar!

⚠️ Se você encontrar outros erros, consulte a seção "Solução de Problemas" abaixo.

## 🎯 Passos Rápidos (Somente Após Atender aos Requisitos!)

### 1. 🛠️ Instale Seu Primeiro Servidor MCP

1. Na extensão Cline, clique na aba `MCP Server`
1. Clique no botão `Edit MCP Settings`

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="Painel do Servidor MCP" width="400" />

1. Os arquivos de configurações do MCP devem ser exibidos em uma aba no VS Code.
1. Substitua o conteúdo do arquivo por este código:

Para Windows:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		}
	}
}
```

Para Mac e Linux:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "npx",
			"args": ["@anaisbetts/mcp-installer"]
		}
	}
}
```

Após salvar o arquivo:

1. O Cline detectará a mudança automaticamente
2. O instalador MCP será baixado e instalado
3. O Cline iniciará o instalador MCP
4. Você verá o status do servidor na interface de configurações do MCP do Cline:

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="Painel do Servidor MCP com Instalador" width="400" />

## 🤔 O que Fazer Agora?

Agora que você tem o instalador MCP, você pode pedir ao Cline para adicionar mais servidores de:

1. Registro NPM: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Índice de Pacotes Python: <https://pypi.org/search/?q=mcp+server-&o=>

Por exemplo, você pode pedir ao Cline para instalar o pacote `mcp-server-fetch` encontrado no Índice de Pacotes Python:

```bash
"instale o servidor MCP chamado `mcp-server-fetch`
- certifique-se de que as configurações do mcp sejam atualizadas.
- use uvx ou python para executar o servidor."
```

Você deve ver o Cline:

1. Instalar o pacote python `mcp-server-fetch`
1. Atualizar o arquivo json de configurações do mcp
1. Iniciar o servidor e iniciar o servidor

O arquivo de configurações do mcp deve agora parecer com isso:

_Para uma máquina Windows:_
```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		},
		"mcp-server-fetch": {
			"command": "uvx",
			"args": ["mcp-server-fetch"]
		}
	}
}
```

Você pode sempre verificar o status do seu servidor acessando a aba do servidor MCP dos clientes. Veja a imagem acima.

Isso é tudo! 🎉 Você acabou de dar ao Cline algumas habilidades incríveis!

## 📝 Solução de Problemas

### 1. Estou usando `asdf` e recebo "comando desconhecido: npx"

Há uma notícia um pouco ruim. Você ainda deve conseguir fazer as coisas funcionarem, mas terá que fazer um pouco mais de trabalho manual, a menos que a embalagem do servidor MCP evolua um pouco. Uma opção é desinstalar o `asdf`, mas vamos assumir que você não quer fazer isso.

Em vez disso, você precisará seguir as instruções acima para "Editar Configurações do MCP". Depois, como [este post](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n) descreve, você precisará adicionar uma entrada "env" para as configurações de cada servidor.

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

O `path_to_asdf_bin_dir` pode ser frequentemente encontrado na sua configuração de shell (por exemplo, `.zshrc`). Se você estiver usando o Homebrew, pode usar `echo ${HOMEBREW_PREFIX}` para encontrar o início do diretório e depois anexar `/opt/asdf/libexec`.

Agora, uma boa notícia. Embora não seja perfeito, você pode fazer o Cline fazer isso para você de forma bastante confiável para instalações subsequentes de servidores. Adicione o seguinte às suas "Instruções Personalizadas" nas configurações do Cline (botão da barra de ferramentas no canto superior direito):

> Ao instalar servidores MCP e editar o arquivo cline_mcp_settings.json, se o servidor exigir o uso de `npx` como comando, você deve copiar a entrada "env" da entrada "mcp-installer" e adicioná-la à nova entrada. Isso é vital para que o servidor funcione corretamente quando em uso.

### 2. Ainda estou recebendo um erro ao executar o instalador MCP

Se você está recebendo um erro ao executar o instalador MCP, você pode tentar o seguinte:

-   Verifique o arquivo de configurações do MCP por erros
-   Leia a documentação do servidor MCP para garantir que o arquivo de configurações do MCP esteja usando o comando e argumentos corretos. 👈
-   Use um terminal e execute o comando com seus argumentos diretamente. Isso permitirá que você veja os mesmos erros que o Cline está vendo.