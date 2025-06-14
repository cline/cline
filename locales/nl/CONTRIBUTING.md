<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • <b>Nederlands</b> • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Bijdragen aan Roo Code

Roo Code is een door de community gedreven project en we waarderen elke bijdrage enorm. Om de samenwerking te stroomlijnen, werken we volgens een [Issue-First](#issue-first-aanpak) principe, wat betekent dat alle [Pull Requests (PR's)](#een-pull-request-indienen) eerst gekoppeld moeten worden aan een GitHub Issue. Lees deze gids zorgvuldig door.

## Inhoudsopgave

- [Voordat je bijdraagt](#voordat-je-bijdraagt)
- [Je bijdrage vinden & plannen](#je-bijdrage-vinden--plannen)
- [Ontwikkelings- & indieningsproces](#ontwikkelings--indieningsproces)
- [Juridisch](#juridisch)

## Voordat je bijdraagt

### 1. Gedragscode

Alle bijdragers moeten zich houden aan onze [Gedragscode](./CODE_OF_CONDUCT.md).

### 2. De project-roadmap

Onze roadmap bepaalt de richting van het project. Stem je bijdragen af op deze kernpunten:

### Betrouwbaarheid eerst

- Zorgen dat diff-bewerking en opdrachtuitvoering consistent betrouwbaar zijn
- Verminderen van wrijvingspunten die regelmatig gebruik ontmoedigen
- Garanderen van soepele werking in alle talen en op alle platforms
- Uitbreiden van robuuste ondersteuning voor een breed scala aan AI-providers en -modellen

### Verbeterde gebruikerservaring

- Vereenvoudigen van de gebruikersinterface voor meer duidelijkheid en intuïtiviteit
- Continu verbeteren van de workflow om te voldoen aan de hoge verwachtingen van ontwikkelaars

### Voorop lopen in agent-prestaties

- Opstellen van uitgebreide evaluatiebenchmarks (evals) om productiviteit in de echte wereld te meten
- Het voor iedereen gemakkelijk maken om deze evaluaties uit te voeren en te interpreteren
- Verbeteringen leveren die duidelijke stijgingen in evaluatiescores aantonen

Vermeld de afstemming met deze gebieden in je PR's.

### 3. Word lid van de Roo Code-community

- **Hoofdmethode:** Word lid van onze [Discord](https://discord.gg/roocode) en stuur een DM naar **Hannes Rudolph (`hrudolph`)**.
- **Alternatief:** Ervaren bijdragers kunnen direct meedoen via [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1).

## Je bijdrage vinden & plannen

### Soorten bijdragen

- **Bugfixes:** Problemen in code oplossen.
- **Nieuwe functies:** Functionaliteit toevoegen.
- **Documentatie:** Handleidingen verbeteren en verduidelijken.

### Issue-First-aanpak

Elke bijdrage moet beginnen met een GitHub Issue.

- **Bestaande issues controleren:** Zoek in [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues).
- **Issue aanmaken:** Gebruik de juiste templates:
    - **Bugs:** "Bug Report"-template.
    - **Functies:** "Detailed Feature Proposal"-template. Goedkeuring vereist voor je begint.
- **Issues claimen:** Reageer en wacht op officiële toewijzing.

**PR's zonder goedgekeurde issues kunnen worden gesloten.**

### Bepalen waar je aan werkt

- Bekijk het [GitHub Project](https://github.com/orgs/RooCodeInc/projects/1) voor niet-toegewezen "Good First Issues".
- Voor documentatie, bezoek [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs).

### Bugs of problemen melden

- Controleer eerst of er al meldingen zijn.
- Maak nieuwe bugmeldingen met de ["Bug Report"-template](https://github.com/RooCodeInc/Roo-Code/issues/new/choose).
- **Beveiligingsproblemen:** Meld privé via [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new).

## Ontwikkelings- & indieningsproces

### Ontwikkelomgeving instellen

1. **Fork & Clone:**

```
git clone https://github.com/JOUW_GEBRUIKERSNAAM/Roo-Code.git
```

2. **Installeer afhankelijkheden:**

```
npm run install:all
```

3. **Debuggen:** Open met VS Code (`F5`).

### Richtlijnen voor het schrijven van code

- Eén gerichte PR per functie of fix.
- Volg ESLint en TypeScript best practices.
- Schrijf duidelijke, beschrijvende commits die verwijzen naar issues (bijv. `Fixes #123`).
- Zorg voor grondige tests (`npm test`).
- Rebase op de nieuwste `main`-branch vóór indiening.

### Een Pull Request indienen

- Begin als **concept-PR** als je vroege feedback zoekt.
- Beschrijf je wijzigingen duidelijk volgens de Pull Request Template.
- Voeg screenshots/video's toe voor UI-wijzigingen.
- Geef aan of documentatie-updates nodig zijn.

### Pull Request beleid

- Moet verwijzen naar vooraf goedgekeurde en toegewezen issues.
- PR's die niet aan het beleid voldoen, kunnen worden gesloten.
- PR's moeten CI-tests doorstaan, aansluiten bij de roadmap en duidelijke documentatie hebben.

### Reviewproces

- **Dagelijkse triage:** Snelle controles door maintainers.
- **Wekelijkse diepgaande review:** Uitgebreide beoordeling.
- **Snel itereren** op basis van feedback.

## Juridisch

Door een pull request in te dienen, ga je ermee akkoord dat je bijdragen worden gelicenseerd onder de Apache 2.0-licentie, in overeenstemming met de licentie van Roo Code.
