# 🚀 MCP Schnellstartanleitung

## ❓ Was ist ein MCP-Server?

Stellen Sie sich MCP-Server als spezielle Helfer vor, die Cline zusätzliche Fähigkeiten verleihen! Sie ermöglichen es Cline, coole Dinge wie das Abrufen von Webseiten oder das Arbeiten mit Ihren Dateien zu tun.

## ⚠️ WICHTIG: Systemanforderungen

STOPP! Bevor Sie fortfahren, MÜSSEN Sie diese Anforderungen überprüfen:

### Erforderliche Software

-   ✅ Neueste Node.js (v18 oder neuer)

    -   Überprüfen Sie mit: `node --version`
    -   Installieren Sie von: <https://nodejs.org/>

-   ✅ Neueste Python (v3.8 oder neuer)

    -   Überprüfen Sie mit: `python --version`
    -   Installieren Sie von: <https://python.org/>

-   ✅ UV Paketmanager
    -   Nach der Installation von Python ausführen: `pip install uv`
    -   Überprüfen Sie mit: `uv --version`

❗ Wenn einer dieser Befehle fehlschlägt oder ältere Versionen anzeigt, installieren/aktualisieren Sie bitte, bevor Sie fortfahren!

⚠️ Wenn Sie auf andere Fehler stoßen, sehen Sie im Abschnitt "Fehlerbehebung" unten nach.

## 🎯 Schnelle Schritte (Nur nach Erfüllung der Anforderungen!)

### 1. 🛠️ Installieren Sie Ihren ersten MCP-Server

1. Klicken Sie in der Cline-Erweiterung auf die Registerkarte `MCP-Server`
1. Klicken Sie auf die Schaltfläche `MCP-Einstellungen bearbeiten`

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP-Server-Panel" width="400" />

1. Die MCP-Einstellungsdateien sollten in einem Tab in VS Code angezeigt werden.
1. Ersetzen Sie den Inhalt der Datei mit diesem Code:

Für Windows:

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

Für Mac und Linux:

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

Nach dem Speichern der Datei:

1. Cline erkennt die Änderung automatisch
2. Der MCP-Installer wird heruntergeladen und installiert
3. Cline startet den MCP-Installer
4. Sie sehen den Serverstatus in der MCP-Einstellungs-Benutzeroberfläche von Cline:

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="MCP-Server-Panel mit Installer" width="400" />

## 🤔 Was kommt als Nächstes?

Jetzt, da Sie den MCP-Installer haben, können Sie Cline bitten, weitere Server von folgenden Quellen hinzuzufügen:

1. NPM-Registry: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Python-Paketindex: <https://pypi.org/search/?q=mcp+server-&o=>

Zum Beispiel können Sie Cline bitten, das Paket `mcp-server-fetch` zu installieren, das im Python-Paketindex gefunden wurde:

```bash
"installiere den MCP-Server namens `mcp-server-fetch`
- stelle sicher, dass die MCP-Einstellungen aktualisiert werden.
- verwende uvx oder python, um den Server zu starten."
```

Sie sollten beobachten, wie Cline:

1. Das Python-Paket `mcp-server-fetch` installiert
1. Die MCP-Einstellungs-JSON-Datei aktualisiert
1. Den Server startet und den Server startet

Die MCP-Einstellungsdatei sollte nun so aussehen:

_Für einen Windows-Rechner:_
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

Sie können den Status Ihres Servers jederzeit überprüfen, indem Sie zum MCP-Server-Tab der Clients gehen. Siehe das Bild oben.

Das war's! 🎉 Sie haben Cline gerade einige großartige neue Fähigkeiten verliehen!

## 📝 Fehlerbehebung

### 1. Ich verwende `asdf` und erhalte "unknown command: npx"

Es gibt schlechte Nachrichten. Sie sollten dennoch in der Lage sein, alles zum Laufen zu bringen, aber Sie müssen etwas mehr manuelle Arbeit leisten, es sei denn, die Verpackung des MCP-Servers entwickelt sich ein wenig weiter. Eine Option wäre, `asdf` zu deinstallieren, aber wir gehen davon aus, dass Sie das nicht tun möchten.

Stattdessen müssen Sie den Anweisungen oben folgen, um die "MCP-Einstellungen" zu bearbeiten. Dann müssen Sie, wie [dieser Beitrag](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n) beschreibt, einen "env"-Eintrag zu den Konfigurationen jedes Servers hinzufügen.

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

Der `path_to_asdf_bin_dir` kann oft in Ihrer Shell-Konfiguration (z.B. `.zshrc`) gefunden werden. Wenn Sie Homebrew verwenden, können Sie `echo ${HOMEBREW_PREFIX}` verwenden, um den Anfang des Verzeichnisses zu finden und dann `/opt/asdf/libexec` anhängen.

Nun zu den guten Nachrichten. Obwohl es nicht perfekt ist, können Sie Cline ziemlich zuverlässig dazu bringen, dies für Sie bei nachfolgenden Serverinstallationen zu tun. Fügen Sie Folgendes zu Ihren "benutzerdefinierten Anweisungen" in den Cline-Einstellungen hinzu (Schaltfläche der oberen rechten Symbolleiste):

> Wenn Sie MCP-Server installieren und die cline_mcp_settings.json bearbeiten, und der Server den Befehl `npx` benötigt, müssen Sie den "env"-Eintrag aus dem "mcp-installer"-Eintrag kopieren und ihn zum neuen Eintrag hinzufügen. Dies ist entscheidend, um den Server ordnungsgemäß zum Laufen zu bringen.

### 2. Ich erhalte immer noch einen Fehler, wenn ich den MCP-Installer ausführe

Wenn Sie beim Ausführen des MCP-Installers einen Fehler erhalten, können Sie Folgendes versuchen:

-   Überprüfen Sie die MCP-Einstellungsdatei auf Fehler
-   Lesen Sie die Dokumentation des MCP-Servers, um sicherzustellen, dass die MCP-Einstellungsdatei den richtigen Befehl und die richtigen Argumente verwendet. 👈
-   Verwenden Sie ein Terminal und führen Sie den Befehl mit seinen Argumenten direkt aus. Dadurch können Sie die gleichen Fehler sehen, die Cline sieht.