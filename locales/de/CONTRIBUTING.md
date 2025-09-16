<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • <b>Deutsch</b> • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Beitrag zu Roo Code

Roo Code ist ein von der Community getragenes Projekt, und wir schätzen jeden Beitrag sehr. Um die Zusammenarbeit zu optimieren, arbeiten wir nach dem [Issue-First-Ansatz](#issue-first-ansatz), was bedeutet, dass alle [Pull Requests (PRs)](#einen-pull-request-einreichen) zuerst mit einem GitHub-Issue verknüpft sein müssen. Bitte lies diesen Leitfaden sorgfältig durch.

## Inhaltsverzeichnis

- [Bevor du beiträgst](#bevor-du-beiträgst)
- [Deinen Beitrag finden und planen](#deinen-beitrag-finden-und-planen)
- [Entwicklungs- und Einreichungsprozess](#entwicklungs-und-einreichungsprozess)
- [Rechtliches](#rechtliches)

## Bevor du beiträgst

### 1. Verhaltenskodex

Alle Mitwirkenden müssen sich an unseren [Verhaltenskodex](./CODE_OF_CONDUCT.md) halten.

### 2. Projekt-Roadmap

Unsere Roadmap gibt die Richtung des Projekts vor. Richte deine Beiträge an diesen Hauptzielen aus:

### Zuverlässigkeit an erster Stelle

- Stelle sicher, dass die Diff-Bearbeitung und die Befehlsausführung durchweg zuverlässig sind.
- Reduziere Reibungspunkte, die von der regelmäßigen Nutzung abhalten.
- Gewährleiste einen reibungslosen Betrieb in allen Gebietsschemata und auf allen Plattformen.
- Erweitere die robuste Unterstützung für eine Vielzahl von KI-Anbietern und -Modellen.

### Verbesserte Benutzererfahrung

- Optimiere die UI/UX für Klarheit und Intuitivität.
- Verbessere kontinuierlich den Arbeitsablauf, um den hohen Erwartungen gerecht zu werden, die Entwickler an täglich genutzte Werkzeuge haben.

### Führend in der Agentenleistung

- Etabliere umfassende Bewertungsmaßstäbe (evals), um die Produktivität in der Praxis zu messen.
- Mache es für jeden einfach, diese Bewertungen auszuführen und zu interpretieren.
- Liefere Verbesserungen, die klare Steigerungen der Bewertungsergebnisse zeigen.

Erwähne die Ausrichtung auf diese Bereiche in deinen PRs.

### 3. Tritt der Roo Code Community bei

- **Primär:** Tritt unserem [Discord](https://discord.gg/roocode) bei und schreibe eine DM an **Hannes Rudolph (`hrudolph`)**.
- **Alternative:** Erfahrene Mitwirkende können sich direkt über [GitHub-Projekte](https://github.com/orgs/RooCodeInc/projects/1) beteiligen.

## Deinen Beitrag finden und planen

### Arten von Beiträgen

- **Fehlerbehebungen:** Behebung von Code-Problemen.
- **Neue Funktionen:** Hinzufügen von Funktionalität.
- **Dokumentation:** Verbesserung von Anleitungen und Klarheit.

### Issue-First-Ansatz

Alle Beiträge beginnen mit einem GitHub-Issue unter Verwendung unserer schlanken Vorlagen.

- **Überprüfe bestehende Issues**: Suche in den [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Erstelle ein Issue** mit:
    - **Verbesserungen:** Vorlage „Verbesserungsvorschlag“ (einfache Sprache mit Fokus auf den Nutzen für den Benutzer).
    - **Fehler:** Vorlage „Fehlerbericht“ (minimale Reproduktion + erwartet vs. tatsächlich + Version).
- **Möchtest du daran arbeiten?** Kommentiere „Claiming“ im Issue und schreibe eine DM an **Hannes Rudolph (`hrudolph`)** auf [Discord](https://discord.gg/roocode), um zugewiesen zu werden. Die Zuweisung wird im Thread bestätigt.
- **PRs müssen auf das Issue verweisen.** Nicht verknüpfte PRs können geschlossen werden.

### Entscheiden, woran du arbeiten möchtest

- Überprüfe das [GitHub-Projekt](https://github.com/orgs/RooCodeInc/projects/1) auf „Issue [Unassigned]“-Issues.
- Für Dokumentation besuche [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Fehler melden

- Überprüfe zuerst, ob bereits Berichte vorhanden sind.
- Erstelle einen neuen Fehler mit der [Vorlage „Fehlerbericht“](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) mit:
    - Klaren, nummerierten Reproduktionsschritten
    - Erwartetes vs. tatsächliches Ergebnis
    - Roo Code-Version (erforderlich); API-Anbieter/Modell, falls relevant
- **Sicherheitsprobleme**: Melde sie privat über [Sicherheitshinweise](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Entwicklungs- und Einreichungsprozess

### Entwicklungseinrichtung

1. **Fork & Klonen:**

```
git clone https://github.com/DEIN_BENUTZERNAME/Roo-Code.git
```

2. **Abhängigkeiten installieren:**

```
pnpm install
```

3. **Debugging:** Mit VS Code öffnen (`F5`).

### Richtlinien zum Schreiben von Code

- Ein fokussierter PR pro Funktion oder Fehlerbehebung.
- Befolge die Best Practices von ESLint und TypeScript.
- Schreibe klare, beschreibende Commits mit Verweis auf Issues (z. B. `Fixes #123`).
- Stelle gründliche Tests bereit (`npm test`).
- Rebase auf den neuesten `main`-Zweig vor der Einreichung.

### Einen Pull Request einreichen

- Beginne als **Entwurfs-PR**, wenn du frühzeitig Feedback einholen möchtest.
- Beschreibe deine Änderungen klar und deutlich gemäß der Pull-Request-Vorlage.
- Verknüpfe das Issue in der PR-Beschreibung/Titel (z. B. „Fixes #123“).
- Stelle Screenshots/Videos für UI-Änderungen bereit.
- Gib an, ob Dokumentationsaktualisierungen erforderlich sind.

### Pull-Request-Richtlinie

- Muss auf ein zugewiesenes GitHub-Issue verweisen. Um zugewiesen zu werden: Kommentiere „Claiming“ im Issue und schreibe eine DM an **Hannes Rudolph (`hrudolph`)** auf [Discord](https://discord.gg/roocode). Die Zuweisung wird im Thread bestätigt.
- Nicht verknüpfte PRs können geschlossen werden.
- PRs müssen die CI-Tests bestehen, mit der Roadmap übereinstimmen und eine klare Dokumentation haben.

### Überprüfungsprozess

- **Tägliche Triage:** Schnelle Überprüfungen durch die Betreuer.
- **Wöchentliche ausführliche Überprüfung:** Umfassende Bewertung.
- **Iteriere umgehend** basierend auf dem Feedback.

## Rechtliches

Indem du einen Beitrag leistest, stimmst du zu, dass deine Beiträge unter der Apache-2.0-Lizenz lizenziert werden, die mit der Lizenzierung von Roo Code übereinstimmt.
