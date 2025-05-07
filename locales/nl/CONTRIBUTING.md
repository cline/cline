[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • <b>Nederlands</b> • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Bijdragen aan Roo Code

Roo Code is een door de community gedreven project en we waarderen elke bijdrage enorm. Om het proces voor iedereen soepel en effectief te laten verlopen, **werken we volgens een "[Issue-First](#2-belangrijk-principe-issue-first-aanpak)" principe.** Dit betekent dat al het werk gekoppeld moet zijn aan een GitHub Issue _voordat_ er een Pull Request wordt ingediend (zie ons [PR-beleid](#pull-request-pr-beleid) voor details). Lees deze gids zorgvuldig door om te begrijpen hoe je kunt bijdragen.
Deze gids beschrijft hoe je kunt bijdragen aan Roo Code, of je nu bugs oplost, functies toevoegt of documentatie verbetert.

## Inhoudsopgave

- [I. Voordat je bijdraagt](#i-voordat-je-bijdraagt)
    - [1. Gedragscode](#1-gedragscode)
    - [2. De project-roadmap begrijpen](#2-de-project-roadmap-begrijpen)
        - [Provider-ondersteuning](#provider-ondersteuning)
        - [Modelondersteuning](#modelondersteuning)
        - [Systeemondersteuning](#systeemondersteuning)
        - [Documentatie](#documentatie)
        - [Stabiliteit](#stabiliteit)
        - [Internationalisatie](#internationalisatie)
    - [3. Word lid van de Roo Code-community](#3-word-lid-van-de-roo-code-community)
- [II. Je bijdrage vinden & plannen](#ii-je-bijdrage-vinden--plannen)
    - [1. Soorten bijdragen](#1-soorten-bijdragen)
    - [2. Belangrijk principe: Issue-First-aanpak](#2-belangrijk-principe-issue-first-aanpak)
    - [3. Bepalen waar je aan werkt](#3-bepalen-waar-je-aan-werkt)
    - [4. Bugs of problemen melden](#4-bugs-of-problemen-melden)
- [III. Ontwikkelings- & indieningsproces](#iii-ontwikkelings--indieningsproces)
    - [1. Ontwikkelomgeving instellen](#1-ontwikkelomgeving-instellen)
    - [2. Richtlijnen voor het schrijven van code](#2-richtlijnen-voor-het-schrijven-van-code)
    - [3. Code indienen: Pull Request (PR) proces](#3-code-indienen-pull-request-pr-proces)
        - [Concept-Pull Requests](#concept-pull-requests)
        - [Pull Request-beschrijving](#pull-request-beschrijving)
        - [Pull Request (PR) beleid](#pull-request-pr-beleid)
            - [Doelstelling](#doelstelling)
            - [Issue-First-aanpak](#issue-first-aanpak)
            - [Voorwaarden voor open PR's](#voorwaarden-voor-open-prs)
            - [Procedure](#procedure)
            - [Verantwoordelijkheden](#verantwoordelijkheden)
- [IV. Juridisch](#iv-juridisch)
    - [Bijdrageovereenkomst](#bijdrageovereenkomst)

## I. Voordat je bijdraagt

Maak je eerst vertrouwd met onze community-standaarden en de richting van het project.

### 1. Gedragscode

Alle bijdragers moeten zich houden aan onze [Gedragscode](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md). Lees deze voordat je bijdraagt.

### 2. De project-roadmap begrijpen

Roo Code heeft een duidelijke ontwikkel-roadmap die onze prioriteiten en toekomstige richting bepaalt. Door de roadmap te begrijpen kun je:

- Je bijdragen afstemmen op de projectdoelen
- Gebieden vinden waar jouw expertise het meest waardevol is
- De context achter bepaalde ontwerpbeslissingen begrijpen
- Inspiratie opdoen voor nieuwe functies die onze visie ondersteunen

Onze huidige roadmap richt zich op zes belangrijke pijlers:

#### Provider-ondersteuning

We willen zoveel mogelijk providers goed ondersteunen:

- Meer "OpenAI Compatible"-ondersteuning
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Verbeterde ondersteuning voor Ollama en LM Studio

#### Modelondersteuning

We willen dat Roo op zoveel mogelijk modellen werkt, inclusief lokale modellen:

- Lokale modelondersteuning via aangepaste systeem-prompts en workflows
- Benchmarking, evaluaties en testcases

#### Systeemondersteuning

We willen dat Roo goed werkt op elke computer:

- Cross-platform terminalintegratie
- Sterke en consistente ondersteuning voor Mac, Windows en Linux

#### Documentatie

We willen uitgebreide, toegankelijke documentatie voor alle gebruikers en bijdragers:

- Uitgebreide gebruikershandleidingen en tutorials
- Duidelijke API-documentatie
- Betere begeleiding voor bijdragers
- Meertalige documentatieresources
- Interactieve voorbeelden en codevoorbeelden

#### Stabiliteit

We willen het aantal bugs aanzienlijk verminderen en geautomatiseerd testen vergroten:

- Debug-logging-schakelaar
- "Machine/Taak-informatie kopiëren"-knop voor bug-/supportverzoeken

#### Internationalisatie

We willen dat Roo ieders taal spreekt:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

We verwelkomen vooral bijdragen die onze roadmap-doelen bevorderen. Als je werkt aan iets dat aansluit bij deze pijlers, vermeld dit dan in je PR-beschrijving.

### 3. Word lid van de Roo Code-community

Contact maken met de Roo Code-community is een geweldige manier om te beginnen:

- **Hoofdmethode**:
    1.  Word lid van de [Roo Code Discord-community](https://discord.gg/roocode).
    2.  Stuur vervolgens een direct bericht (DM) naar **Hannes Rudolph** (Discord: `hrudolph`) om je interesse te bespreken en advies te krijgen.
- **Alternatief voor ervaren bijdragers**: Als je vertrouwd bent met de Issue-First-aanpak, kun je direct via GitHub meedoen door het [Kanban-bord](https://github.com/orgs/RooVetGit/projects/1) te volgen en te communiceren via issues en pull requests.

## II. Je bijdrage vinden & plannen

Bepaal waar je aan wilt werken en hoe je dat aanpakt.

### 1. Soorten bijdragen

We verwelkomen verschillende soorten bijdragen:

- **Bugfixes**: Problemen in bestaande code oplossen
- **Nieuwe functies**: Nieuwe functionaliteit toevoegen
- **Documentatie**: Handleidingen verbeteren, voorbeelden toevoegen of typefouten corrigeren

### 2. Belangrijk principe: Issue-First-aanpak

**Elke bijdrage moet beginnen met een GitHub Issue.** Dit is essentieel om afstemming te waarborgen en verspilde moeite te voorkomen.

- **Issue zoeken of aanmaken**:
    - Zoek voordat je begint in [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) of er al een issue bestaat voor jouw bijdrage.
    - Als het bestaat en niet is toegewezen, reageer dan om aan te geven dat je het wilt oppakken. Een maintainer wijst het dan toe.
    - Als het niet bestaat, maak dan een nieuwe aan met de juiste template op onze [issues-pagina](https://github.com/RooVetGit/Roo-Code/issues/new/choose):
        - Voor bugs: "Bug Report"-template
        - Voor nieuwe functies: "Detailed Feature Proposal"-template. Wacht op goedkeuring van een maintainer (vooral @hannesrudolph) voordat je begint met implementeren.
        - **Let op**: Algemene ideeën of eerste discussies over functies kunnen starten in [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests). Zodra het idee concreter is, moet er een "Detailed Feature Proposal"-issue worden aangemaakt.
- **Claimen en toewijzen**:
    - Geef duidelijk aan dat je aan een issue wilt werken door erop te reageren.
    - Wacht tot een maintainer het officieel aan je toewijst in GitHub. Zo voorkomen we dat meerdere mensen aan hetzelfde werken.
- **Gevolgen van niet volgen**:
    - Pull Requests (PR's) zonder een bijbehorend, vooraf goedgekeurd en toegewezen issue kunnen zonder volledige review worden gesloten. Dit beleid is bedoeld om ervoor te zorgen dat bijdragen aansluiten bij de projectprioriteiten en om ieders tijd te respecteren.

Deze aanpak helpt ons om werk te volgen, te zorgen dat wijzigingen gewenst zijn en inspanningen effectief te coördineren.

### 3. Bepalen waar je aan werkt

- **Good First Issues**: Bekijk de sectie "Issue [Unassigned]" van ons [Roo Code Issues-project](https://github.com/orgs/RooVetGit/projects/1) op GitHub.
- **Documentatie**: Hoewel deze `CONTRIBUTING.md` de hoofdgids is voor codebijdragen, als je wilt bijdragen aan andere documentatie (zoals gebruikershandleidingen of API-documentatie), bekijk dan de [Roo Code Docs-repository](https://github.com/RooVetGit/Roo-Code-Docs) of vraag het in de Discord-community.
- **Nieuwe functies voorstellen**:
    1.  **Eerste idee/discussie**: Voor brede of eerste ideeën, start een gesprek in [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
    2.  **Formeel voorstel**: Voor specifieke, uitvoerbare voorstellen, maak een "Detailed Feature Proposal"-issue aan met de template op onze [issues-pagina](https://github.com/RooVetGit/Roo-Code/issues/new/choose). Dit is een belangrijk onderdeel van onze **Issue-First-aanpak**.

### 4. Bugs of problemen melden

Als je een bug vindt:

1.  **Bestaande issues zoeken**: Controleer [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) op duplicaten.
2.  **Nieuw issue aanmaken**: Als het uniek is, gebruik dan de "Bug Report"-template op onze [issues-pagina](https://github.com/RooVetGit/Roo-Code/issues/new/choose).

> 🔐 **Beveiligingsproblemen**: Als je een beveiligingsprobleem ontdekt, meld dit dan privé via de [GitHub Security Advisory Tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new). Maak geen openbaar issue voor beveiligingsproblemen.

## III. Ontwikkelings- & indieningsproces

Volg deze stappen voor het coderen en indienen van je werk.

### 1. Ontwikkelomgeving instellen

1.  **Fork & Clone**:
    - Fork de repository op GitHub.
    - Clone je fork lokaal: `git clone https://github.com/JOUW_GEBRUIKERSNAAM/Roo-Code.git`
2.  **Installeer afhankelijkheden**: `npm run install:all`
3.  **Start Webview (Dev Mode)**: `npm run dev` (voor de Vite/React-app met HMR)
4.  **Debug de extensie**: Druk op `F5` in VS Code (of **Run** → **Start Debugging**) om een nieuw Extension Development Host-venster met Roo Code te openen.

Wijzigingen in webview (`webview-ui`) verschijnen direct dankzij Hot Module Replacement. Wijzigingen aan de core-extensie (`src`) vereisen een herstart van de Extension Development Host.

Je kunt ook een `.vsix`-pakket bouwen en installeren:

```sh
npm run build
code --install-extension bin/roo-cline-<versie>.vsix
```

(Vervang `<versie>` door het daadwerkelijke versienummer van het gegenereerde bestand.)

### 2. Richtlijnen voor het schrijven van code

- **Gerichte PR's**: Eén feature/bugfix per PR.
- **Codekwaliteit**:
    - CI-checks doorstaan (linten, formatteren)
    - ESLint-waarschuwingen of fouten oplossen (`npm run lint`)
    - Reageren op feedback van automatische code review-tools
    - TypeScript best practices volgen en typeveiligheid behouden
- **Testen**:
    - Tests toevoegen voor nieuwe features
    - `npm test` uitvoeren om te zorgen dat alles slaagt
    - Bestaande tests bijwerken als je wijzigingen ze beïnvloeden
- **Commitberichten**:
    - Duidelijke, beschrijvende commitberichten schrijven
    - Relevante issues refereren met `#issue-nummer` (bijv. `Fixes #123`)
- **Checklist voor het indienen van een PR**:
    - Je branch rebasen op de laatste `main` van upstream
    - Controleren of je code bouwt (`npm run build`)
    - Alle tests moeten slagen (`npm test`)
    - Debugcode of `console.log`-statements verwijderen

### 3. Code indienen: Pull Request (PR) proces

#### Concept-Pull Requests

Gebruik concept-PR's voor werk dat nog niet klaar is voor volledige review, maar waarvoor je:

- Geautomatiseerde checks (CI) wilt uitvoeren
- Vroeg feedback wilt van maintainers of andere bijdragers
- Wilt aangeven dat het werk in uitvoering is

Markeer een PR pas als "Ready for Review" als alle checks slagen en je denkt dat deze voldoet aan de criteria van "Richtlijnen voor het schrijven van code" en "Pull Request-beschrijving".

#### Pull Request-beschrijving

De beschrijving van je PR moet volledig zijn en de structuur van onze [Pull Request Template](.github/pull_request_template.md) volgen. Belangrijke punten:

- Een link naar het goedgekeurde GitHub Issue dat wordt aangepakt
- Een duidelijke beschrijving van de gemaakte wijzigingen en het doel ervan
- Gedetailleerde stappen om de wijzigingen te testen
- Een lijst van eventuele breaking changes
- **Voor UI-wijzigingen: voor-en-na screenshots of video's**
- **Geef aan of je PR gebruikersdocumentatie moet bijwerken en welke documenten/secties worden beïnvloed**

#### Pull Request (PR) beleid

##### Doelstelling

Een schone, gerichte en beheersbare PR-backlog behouden.

##### Issue-First-aanpak

- **Vereist**: Voordat je begint, moet er een bestaand, goedgekeurd en toegewezen GitHub Issue zijn ("Bug Report" of "Detailed Feature Proposal").
- **Goedkeuring**: Issues, vooral voor grote wijzigingen, moeten vooraf worden beoordeeld en goedgekeurd door maintainers (vooral @hannesrudolph).
- **Referentie**: PR's moeten deze vooraf goedgekeurde issues expliciet in hun beschrijving vermelden.
- **Gevolgen**: Niet volgen van dit proces kan ertoe leiden dat je PR zonder volledige review wordt gesloten.

##### Voorwaarden voor open PR's

- **Klaar om te mergen**: Slaagt voor alle CI-tests, sluit aan bij de roadmap (indien van toepassing), is gekoppeld aan een goedgekeurd en toegewezen issue, heeft duidelijke documentatie/commentaar, bevat voor-en-na beelden/video's voor UI-wijzigingen
- **Te sluiten**: CI-testfouten, grote mergeconflicten, geen aansluiting bij projectdoelen of langdurige inactiviteit (>30 dagen zonder updates na feedback)

##### Procedure

1.  **Issue-kwalificatie & toewijzing**: @hannesrudolph (of andere maintainers) beoordelen en wijzen nieuwe en bestaande issues toe.
2.  **Eerste PR-triage (dagelijks)**: Maintainers doen een snelle check van nieuwe PR's op urgentie of kritieke zaken.
3.  **Grondige PR-review (wekelijks)**: Maintainers beoordelen PR's op gereedheid, aansluiting bij het goedgekeurde issue en algemene kwaliteit.
4.  **Gedetailleerde feedback & iteratie**: Op basis van de review geven maintainers feedback (Approve, Request Changes, Reject). Van bijdragers wordt verwacht dat ze reageren en waar nodig verbeteren.
5.  **Beslissingsfase**: Goedgekeurde PR's worden gemerged. PR's met onoplosbare problemen of die niet aansluiten kunnen met uitleg worden gesloten.
6.  **Follow-up**: Auteurs van gesloten PR's kunnen feedback verwerken en nieuwe PR's openen als problemen zijn opgelost of de projectrichting verandert.

##### Verantwoordelijkheden

- **Issue-kwalificatie & procesbewaking (@hannesrudolph & maintainers)**: Zorgen dat alle bijdragen de Issue-First-aanpak volgen. Bijdragers begeleiden in het proces.
- **Maintainers (Dev Team)**: PR's beoordelen, technisch feedback geven, goedkeuren/afwijzen, PR's mergen.
- **Bijdragers**: PR's koppelen aan een goedgekeurd en toegewezen issue, voldoen aan kwaliteitsrichtlijnen en snel reageren op feedback.

Dit beleid zorgt voor duidelijkheid en efficiënte integratie.

## IV. Juridisch

### Bijdrageovereenkomst

Door een pull request in te dienen, ga je ermee akkoord dat je bijdragen worden gelicenseerd onder de [Apache 2.0-licentie](LICENSE) (of de huidige licentie van het project), net als het project.
