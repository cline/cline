# 🚀 Guide de démarrage rapide MCP

## ❓ Qu'est-ce qu'un serveur MCP ?

Considérez les serveurs MCP comme des assistants spéciaux qui donnent à Cline des pouvoirs supplémentaires ! Ils permettent à Cline de faire des choses cool comme récupérer des pages web ou travailler avec vos fichiers.

## ⚠️ IMPORTANT : Exigences système

STOP ! Avant de continuer, vous DEVEZ vérifier ces exigences :

### Logiciels requis

-   ✅ Dernière version de Node.js (v18 ou plus récente)

    -   Vérifiez en exécutant : `node --version`
    -   Installez depuis : <https://nodejs.org/>

-   ✅ Dernière version de Python (v3.8 ou plus récente)

    -   Vérifiez en exécutant : `python --version`
    -   Installez depuis : <https://python.org/>

-   ✅ Gestionnaire de paquets UV
    -   Après avoir installé Python, exécutez : `pip install uv`
    -   Vérifiez avec : `uv --version`

❗ Si l'une de ces commandes échoue ou affiche des versions plus anciennes, veuillez installer/mettre à jour avant de continuer !

⚠️ Si vous rencontrez d'autres erreurs, consultez la section "Dépannage" ci-dessous.

## 🎯 Étapes rapides (seulement après avoir satisfait aux exigences !)

### 1. 🛠️ Installer votre premier serveur MCP

1. Depuis l'extension Cline, cliquez sur l'onglet `MCP Server`
1. Cliquez sur le bouton `Edit MCP Settings`

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="Panneau du serveur MCP" width="400" />

1. Les fichiers de paramètres MCP devraient s'afficher dans un onglet dans VS Code.
1. Remplacez le contenu du fichier par ce code :

Pour Windows :

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

Pour Mac et Linux :

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

Après avoir enregistré le fichier :

1. Cline détectera automatiquement le changement
2. L'installateur MCP sera téléchargé et installé
3. Cline lancera l'installateur MCP
4. Vous verrez le statut du serveur dans l'interface utilisateur des paramètres MCP de Cline :

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="Panneau du serveur MCP avec installateur" width="400" />

## 🤔 Qu'est-ce qui suit ?

Maintenant que vous avez l'installateur MCP, vous pouvez demander à Cline d'ajouter plus de serveurs depuis :

1. Registre NPM : <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Index des paquets Python : <https://pypi.org/search/?q=mcp+server-&o=>

Par exemple, vous pouvez demander à Cline d'installer le paquet `mcp-server-fetch` trouvé sur l'Index des paquets Python :

```bash
"installer le serveur MCP nommé `mcp-server-fetch`
- s'assurer que les paramètres mcp sont mis à jour.
- utiliser uvx ou python pour exécuter le serveur."
```

Vous devriez voir Cline :

1. Installer le paquet python `mcp-server-fetch`
1. Mettre à jour le fichier json des paramètres mcp
1. Démarrer le serveur et lancer le serveur

Le fichier de paramètres mcp devrait maintenant ressembler à ceci :

_Pour une machine Windows :_
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

Vous pouvez toujours vérifier l'état de votre serveur en allant dans l'onglet serveur MCP des clients. Voir l'image ci-dessus.

C'est tout ! 🎉 Vous venez de donner à Cline de nouvelles capacités incroyables !

## 📝 Dépannage

### 1. J'utilise `asdf` et j'obtiens "commande inconnue : npx"

Il y a une mauvaise nouvelle. Vous devriez toujours pouvoir faire fonctionner les choses, mais vous devrez faire un peu plus de travail manuel à moins que l'emballage du serveur MCP n'évolue un peu. Une option est de désinstaller `asdf`, mais nous supposerons que vous ne voulez pas le faire.

Au lieu de cela, vous devrez suivre les instructions ci-dessus pour "Modifier les paramètres MCP". Ensuite, comme le décrit [ce post](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n), vous devrez ajouter une entrée "env" à la configuration de chaque serveur.

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

Le `path_to_asdf_bin_dir` peut souvent être trouvé dans votre configuration de shell (par exemple `.zshrc`). Si vous utilisez Homebrew, vous pouvez utiliser `echo ${HOMEBREW_PREFIX}` pour trouver le début du répertoire et ensuite ajouter `/opt/asdf/libexec`.

Maintenant, une bonne nouvelle. Bien que ce ne soit pas parfait, vous pouvez faire en sorte que Cline le fasse pour vous de manière assez fiable pour les installations de serveur suivantes. Ajoutez ce qui suit à vos "Instructions personnalisées" dans les paramètres de Cline (bouton de la barre d'outils en haut à droite) :

> Lors de l'installation des serveurs MCP et de la modification du fichier cline_mcp_settings.json, si le serveur nécessite l'utilisation de `npx` comme commande, vous devez copier l'entrée "env" de l'entrée "mcp-installer" et l'ajouter à la nouvelle entrée. Cela est vital pour que le serveur fonctionne correctement lors de son utilisation.

### 2. Je reçois toujours une erreur lorsque j'exécute l'installateur MCP

Si vous recevez une erreur lorsque vous exécutez l'installateur MCP, vous pouvez essayer ce qui suit :

-   Vérifiez le fichier de paramètres MCP pour des erreurs
-   Lisez la documentation du serveur MCP pour vous assurer que le fichier de paramètres MCP utilise la commande et les arguments corrects. 👈
-   Utilisez un terminal et exécutez directement la commande avec ses arguments. Cela vous permettra de voir les mêmes erreurs que Cline.