# Beitrag zu Roo Code

Wir freuen uns, dass Sie Interesse haben, zu Roo Code beizutragen. Ob Sie einen Fehler beheben, eine Funktion hinzufügen oder unsere Dokumentation verbessern, jeder Beitrag macht Roo Code intelligenter! Um unsere Community lebendig und einladend zu halten, müssen sich alle Mitglieder an unseren [Verhaltenskodex](CODE_OF_CONDUCT.md) halten.

## Treten Sie unserer Community bei

Wir ermutigen alle Mitwirkenden nachdrücklich, unserer [Discord-Community](https://discord.gg/roocode) beizutreten! Teil unseres Discord-Servers zu sein, hilft Ihnen:

- Echtzeit-Hilfe und Anleitung für Ihre Beiträge zu erhalten
- Mit anderen Mitwirkenden und Kernteammitgliedern in Kontakt zu treten
- Über Projektentwicklungen und Prioritäten auf dem Laufenden zu bleiben
- An Diskussionen teilzunehmen, die die Zukunft von Roo Code gestalten
- Kooperationsmöglichkeiten mit anderen Entwicklern zu finden

## Fehler oder Probleme melden

Fehlerberichte helfen, Roo Code für alle besser zu machen! Bevor Sie ein neues Issue erstellen, bitte [suchen Sie in bestehenden Issues](https://github.com/RooVetGit/Roo-Code/issues), um Duplikate zu vermeiden. Wenn Sie bereit sind, einen Fehler zu melden, gehen Sie zu unserer [Issues-Seite](https://github.com/RooVetGit/Roo-Code/issues/new/choose), wo Sie eine Vorlage finden, die Ihnen beim Ausfüllen der relevanten Informationen hilft.

<blockquote class='warning-note'>
     🔐 <b>Wichtig:</b> Wenn Sie eine Sicherheitslücke entdecken, nutzen Sie bitte das <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">Github-Sicherheitstool, um sie privat zu melden</a>.
</blockquote>

## Entscheiden, woran Sie arbeiten möchten

Suchen Sie nach einem guten ersten Beitrag? Schauen Sie sich Issues im Abschnitt "Issue [Unassigned]" unseres [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) Github-Projekts an. Diese sind speziell für neue Mitwirkende und Bereiche ausgewählt, in denen wir Hilfe gebrauchen könnten!

Wir begrüßen auch Beiträge zu unserer [Dokumentation](https://docs.roocode.com/)! Ob Sie Tippfehler korrigieren, bestehende Anleitungen verbessern oder neue Bildungsinhalte erstellen - wir würden gerne ein Community-geführtes Repository von Ressourcen aufbauen, das jedem hilft, das Beste aus Roo Code herauszuholen. Sie können auf jeder Seite auf "Edit this page" klicken, um schnell zur richtigen Stelle in Github zu gelangen, um die Datei zu bearbeiten, oder Sie können direkt zu https://github.com/RooVetGit/Roo-Code-Docs gehen.

Wenn Sie an einer größeren Funktion arbeiten möchten, erstellen Sie bitte zuerst eine [Funktionsanfrage](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop), damit wir diskutieren können, ob sie mit der Vision von Roo Code übereinstimmt.

## Entwicklungs-Setup

1. **Klonen** Sie das Repository:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Installieren Sie Abhängigkeiten**:

```sh
npm run install:all
```

3. **Starten Sie die Webansicht (Vite/React-App mit HMR)**:

```sh
npm run dev
```

4. **Debugging**:
   Drücken Sie `F5` (oder **Ausführen** → **Debugging starten**) in VSCode, um eine neue Sitzung mit geladenem Roo Code zu öffnen.

Änderungen an der Webansicht erscheinen sofort. Änderungen an der Kern-Erweiterung erfordern einen Neustart des Erweiterungs-Hosts.

Alternativ können Sie eine .vsix-Datei erstellen und direkt in VSCode installieren:

```sh
npm run build
```

Eine `.vsix`-Datei erscheint im `bin/`-Verzeichnis, die mit folgendem Befehl installiert werden kann:

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## Code schreiben und einreichen

Jeder kann Code zu Roo Code beitragen, aber wir bitten Sie, diese Richtlinien zu befolgen, um sicherzustellen, dass Ihre Beiträge reibungslos integriert werden können:

1. **Halten Sie Pull Requests fokussiert**

    - Beschränken Sie PRs auf eine einzelne Funktion oder Fehlerbehebung
    - Teilen Sie größere Änderungen in kleinere, zusammenhängende PRs auf
    - Unterteilen Sie Änderungen in logische Commits, die unabhängig überprüft werden können

2. **Codequalität**

    - Alle PRs müssen CI-Prüfungen bestehen, die sowohl Linting als auch Formatierung umfassen
    - Beheben Sie alle ESLint-Warnungen oder -Fehler vor dem Einreichen
    - Reagieren Sie auf alle Rückmeldungen von Ellipsis, unserem automatisierten Code-Review-Tool
    - Folgen Sie TypeScript-Best-Practices und halten Sie die Typsicherheit aufrecht

3. **Testen**

    - Fügen Sie Tests für neue Funktionen hinzu
    - Führen Sie `npm test` aus, um sicherzustellen, dass alle Tests bestanden werden
    - Aktualisieren Sie bestehende Tests, wenn Ihre Änderungen diese beeinflussen
    - Schließen Sie sowohl Unit-Tests als auch Integrationstests ein, wo angemessen

4. **Commit-Richtlinien**

    - Schreiben Sie klare, beschreibende Commit-Nachrichten
    - Verweisen Sie auf relevante Issues in Commits mit #issue-nummer

5. **Vor dem Einreichen**

    - Rebasen Sie Ihren Branch auf den neuesten main-Branch
    - Stellen Sie sicher, dass Ihr Branch erfolgreich baut
    - Überprüfen Sie erneut, dass alle Tests bestanden werden
    - Prüfen Sie Ihre Änderungen auf Debug-Code oder Konsolenausgaben

6. **Pull Request Beschreibung**
    - Beschreiben Sie klar, was Ihre Änderungen bewirken
    - Fügen Sie Schritte zum Testen der Änderungen hinzu
    - Listen Sie alle Breaking Changes auf
    - Fügen Sie Screenshots für UI-Änderungen hinzu

## Beitragsvereinbarung

Durch das Einreichen eines Pull Requests stimmen Sie zu, dass Ihre Beiträge unter derselben Lizenz wie das Projekt ([Apache 2.0](../LICENSE)) lizenziert werden.
