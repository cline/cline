[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • <b>Deutsch</b> • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Beitrag zu Roo Code

Roo Code ist ein Community-getriebenes Projekt, und wir schätzen jeden Beitrag sehr. Für eine reibungslose Zusammenarbeit arbeiten wir nach dem [Issue-First-Ansatz](#issue-first-ansatz), was bedeutet, dass alle [Pull Requests (PRs)](#einen-pull-request-einreichen) zuerst mit einem GitHub Issue verknüpft werden müssen. Bitte lies diesen Leitfaden sorgfältig durch.

## Inhaltsverzeichnis

- [Bevor du beiträgst](#bevor-du-beiträgst)
- [Beitrag finden & planen](#beitrag-finden--planen)
- [Entwicklung & Einreichung](#entwicklung--einreichung)
- [Rechtliches](#rechtliches)

## Bevor du beiträgst

### 1. Verhaltenskodex

Alle Mitwirkenden müssen sich an unseren [Verhaltenskodex](./CODE_OF_CONDUCT.md) halten.

### 2. Projekt-Roadmap

Unsere Roadmap gibt die Richtung des Projekts vor. Richte deine Beiträge an diesen Schlüsselzielen aus:

### Zuverlässigkeit an erster Stelle

- Sicherstellen, dass Diff-Bearbeitung und Befehlsausführung durchgängig zuverlässig sind.
- Reibungspunkte reduzieren, die von der regelmäßigen Nutzung abhalten.
- Reibungslosen Betrieb in allen Sprachen und auf allen Plattformen garantieren.
- Robuste Unterstützung für eine Vielzahl von KI-Anbietern und -Modellen ausbauen.

### Verbesserte Benutzererfahrung

- Die Benutzeroberfläche für mehr Klarheit und Intuitivität optimieren.
- Den Workflow kontinuierlich verbessern, um den hohen Erwartungen gerecht zu werden, die Entwickler an täglich genutzte Tools stellen.

### Führend bei der Agentenleistung

- Umfassende Evaluierungsmaßstäbe (Evals) etablieren, um die Produktivität in der realen Welt zu messen.
- Es für jeden einfach machen, diese Evals durchzuführen und zu interpretieren.
- Verbesserungen liefern, die klare Steigerungen der Eval-Ergebnisse zeigen.

Erwähne die Ausrichtung an diesen Bereichen in deinen PRs.

### 3. Werde Teil der Roo Code Community

- **Hauptweg:** Tritt unserem [Discord](https://discord.gg/roocode) bei und schreibe eine DM an **Hannes Rudolph (`hrudolph`)**.
- **Alternative:** Erfahrene Mitwirkende können sich direkt über [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1) beteiligen.

## Beitrag finden & planen

### Beitragsarten

- **Bugfixes:** Fehler im Code beheben.
- **Neue Features:** Neue Funktionen hinzufügen.
- **Dokumentation:** Anleitungen verbessern und klarer gestalten.

### Issue-First-Ansatz

Alle Beiträge müssen mit einem GitHub Issue beginnen.

- **Bestehende Issues prüfen**: Durchsuche die [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Issue erstellen**: Nutze die passenden Vorlagen:
    - **Bugs:** "Bug Report"-Vorlage.
    - **Features:** "Detailed Feature Proposal"-Vorlage. Vor dem Start ist eine Genehmigung erforderlich.
- **Issues beanspruchen**: Kommentiere und warte auf die offizielle Zuweisung.

**PRs ohne genehmigte Issues können geschlossen werden.**

### Was soll ich machen?

- Schau im [GitHub Project](https://github.com/orgs/RooCodeInc/projects/1) nach nicht zugewiesenen "Good First Issues".
- Für Dokumentation besuche das [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs) Repository.

### Bugs melden

- Prüfe zuerst, ob der Bug bereits gemeldet wurde.
- Erstelle neue Bug-Reports mit der ["Bug Report"-Vorlage](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Sicherheitslücken:** Melde diese privat über [Security Advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Entwicklung & Einreichung

### Entwicklungs-Setup

1. **Fork & Clone:**

```
git clone https://github.com/DEIN_USERNAME/Roo-Code.git
```

2. **Abhängigkeiten installieren:**

```
npm run install:all
```

3. **Debugging:** Öffne mit VS Code (`F5`).

### Code-Richtlinien

- Ein fokussierter PR pro Feature oder Fix.
- Folge den ESLint und TypeScript Best Practices.
- Schreibe klare, beschreibende Commits, die auf Issues verweisen (z.B. `Fixes #123`).
- Liefere gründliche Tests (`npm test`).
- Rebase auf den neuesten `main`-Branch vor dem Einreichen.

### Einen Pull Request einreichen

- Beginne als **Draft PR**, wenn du frühes Feedback suchst.
- Beschreibe deine Änderungen klar und folge der Pull Request Vorlage.
- Stelle Screenshots/Videos für UI-Änderungen bereit.
- Gib an, ob Dokumentationsaktualisierungen notwendig sind.

### Pull Request Richtlinie

- Muss auf vorab genehmigte, zugewiesene Issues verweisen.
- PRs ohne Einhaltung der Richtlinie können geschlossen werden.
- PRs sollten CI-Tests bestehen, zur Roadmap passen und klare Dokumentation haben.

### Review-Prozess

- **Tägliche Triage:** Schnelle Prüfungen durch Maintainer.
- **Wöchentliche Tiefenprüfung:** Umfassende Bewertung.
- **Zeitnah auf Feedback reagieren** und entsprechend iterieren.

## Rechtliches

Mit deinem Beitrag erklärst du dich damit einverstanden, dass deine Beiträge unter der Apache 2.0 Lizenz lizenziert werden, konsistent mit der Lizenzierung von Roo Code.
