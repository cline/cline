# Bijdragen aan Roo Code

We zijn blij dat je wilt bijdragen aan Roo Code. Of je nu een bug oplost, een nieuwe functie toevoegt of onze documentatie verbetert, elke bijdrage maakt Roo Code slimmer! Om onze community levendig en gastvrij te houden, moeten alle leden zich houden aan onze [Gedragscode](CODE_OF_CONDUCT.md).

## Word lid van onze community

We raden alle bijdragers sterk aan om lid te worden van onze [Discord-community](https://discord.gg/roocode)! Deelname aan onze Discord-server helpt je:

- Direct hulp en begeleiding te krijgen bij je bijdragen
- In contact te komen met andere bijdragers en het kernteam
- Op de hoogte te blijven van projectontwikkelingen en prioriteiten
- Mee te doen aan discussies die de toekomst van Roo Code vormgeven
- Samenwerkingsmogelijkheden te vinden met andere ontwikkelaars

## Bugs of problemen melden

Bugmeldingen helpen Roo Code voor iedereen beter te maken! Zoek voordat je een nieuw issue aanmaakt eerst naar [bestaande issues](https://github.com/RooVetGit/Roo-Code/issues) om duplicaten te voorkomen. Klaar om een bug te melden? Ga dan naar onze [issues-pagina](https://github.com/RooVetGit/Roo-Code/issues/new/choose) waar je een sjabloon vindt om je te helpen de relevante informatie in te vullen.

<blockquote class='warning-note'>
     🔐 <b>Belangrijk:</b> Als je een beveiligingsprobleem ontdekt, gebruik dan het <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">Github-beveiligingsformulier om het privé te melden</a>.
</blockquote>

## Waar kun je aan werken?

Op zoek naar een goed eerste issue? Bekijk de issues in de sectie "Issue [Unassigned]" van ons [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) Github Project. Deze zijn speciaal geselecteerd voor nieuwe bijdragers en gebieden waar we graag hulp willen!

We verwelkomen ook bijdragen aan onze [documentatie](https://docs.roocode.com/)! Of het nu gaat om het verbeteren van bestaande handleidingen, het corrigeren van typefouten of het maken van nieuwe educatieve content - we bouwen graag samen aan een community-gedreven kennisbank. Je kunt op elke pagina op "Edit this page" klikken om snel naar het juiste bestand op Github te gaan, of direct naar https://github.com/RooVetGit/Roo-Code-Docs.

Wil je aan een grotere functie werken? Maak dan eerst een [feature request](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop) aan zodat we kunnen bespreken of het past bij de visie van Roo Code. Bekijk ook onze [Project Roadmap](#project-roadmap) hieronder om te zien of je idee aansluit bij onze strategische richting.

## Project Roadmap

Roo Code heeft een duidelijke ontwikkelroutekaart die onze prioriteiten en toekomstige richting bepaalt. Door onze roadmap te begrijpen kun je:

- Je bijdragen afstemmen op projectdoelen
- Gebieden identificeren waar jouw expertise het meest waardevol is
- De context achter bepaalde ontwerpkeuzes begrijpen
- Inspiratie opdoen voor nieuwe functies die onze visie ondersteunen

Onze huidige roadmap richt zich op zes belangrijke pijlers:

### Providerondersteuning

We willen zoveel mogelijk providers goed ondersteunen:

- Meer veelzijdige "OpenAI Compatible"-ondersteuning
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Verbeterde ondersteuning voor Ollama en LM Studio

### Modelondersteuning

We willen dat Roo zo goed mogelijk werkt op zoveel mogelijk modellen, inclusief lokale modellen:

- Lokale modelondersteuning via aangepaste systeemaansturing en workflows
- Benchmarking, evaluaties en testcases

### Systeemondersteuning

We willen dat Roo goed draait op ieders computer:

- Cross-platform terminalintegratie
- Sterke en consistente ondersteuning voor Mac, Windows en Linux

### Documentatie

We willen uitgebreide, toegankelijke documentatie voor alle gebruikers en bijdragers:

- Uitgebreide gebruikershandleidingen en tutorials
- Duidelijke API-documentatie
- Betere bijdragersgids
- Meertalige documentatiebronnen
- Interactieve voorbeelden en codevoorbeelden

### Stabiliteit

We willen het aantal bugs aanzienlijk verminderen en geautomatiseerd testen uitbreiden:

- Debug logging-schakelaar
- "Machine/Taak-informatie" kopieerknop voor bug/supportverzoeken

### Internationalisatie

We willen dat Roo ieders taal spreekt:

- Wij willen dat Roo Code ieders taal spreekt
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

We verwelkomen vooral bijdragen die onze roadmap-doelen ondersteunen. Als je werkt aan iets dat aansluit bij deze pijlers, vermeld dit dan in je PR-beschrijving.

## Ontwikkelomgeving instellen

1. **Kloon** de repo:

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **Installeer afhankelijkheden**:

```sh
npm run install:all
```

3. **Start de webview (Vite/React-app met HMR)**:

```sh
npm run dev
```

4. **Debuggen**:
   Druk op `F5` (of **Run** → **Start Debugging**) in VSCode om een nieuwe sessie met Roo Code te openen.

Wijzigingen aan de webview verschijnen direct. Wijzigingen aan de core-extensie vereisen een herstart van de extensiehost.

Je kunt ook een .vsix bouwen en deze direct in VSCode installeren:

```sh
npm run build
```

Een `.vsix`-bestand verschijnt in de `bin/`-map en kan worden geïnstalleerd met:

```sh
code --install-extension bin/roo-cline-<versie>.vsix
```

## Code schrijven en indienen

Iedereen kan code bijdragen aan Roo Code, maar we vragen je deze richtlijnen te volgen zodat je bijdrage soepel kan worden geïntegreerd:

1. **Houd Pull Requests gefocust**
    - Beperk PR's tot één functie of bugfix
    - Splits grotere wijzigingen op in kleinere, gerelateerde PR's
    - Maak logische commits die onafhankelijk kunnen worden beoordeeld

2. **Codekwaliteit**
    - Alle PR's moeten slagen voor CI-checks, inclusief linting en formatting
    - Los alle ESLint-waarschuwingen of -fouten op voor je indient
    - Reageer op alle feedback van Ellipsis, onze geautomatiseerde code-reviewtool
    - Volg TypeScript best practices en behoud typesafety

3. **Testen**
    - Voeg tests toe voor nieuwe functies
    - Voer `npm test` uit om te controleren of alle tests slagen
    - Werk bestaande tests bij als je wijzigingen ze beïnvloeden
    - Voeg waar mogelijk zowel unit- als integratietests toe

4. **Commitrichtlijnen**
    - Schrijf duidelijke, beschrijvende commitberichten
    - Verwijs naar relevante issues in commits met #issue-nummer

5. **Voor het indienen**
    - Rebase je branch op de laatste main
    - Controleer of je branch succesvol bouwt
    - Controleer of alle tests slagen
    - Controleer je wijzigingen op debuggingcode of console.logs

6. **Pull Request-beschrijving**
    - Beschrijf duidelijk wat je wijzigingen doen
    - Voeg stappen toe om de wijzigingen te testen
    - Noem eventuele breaking changes
    - Voeg screenshots toe bij UI-wijzigingen

## Bijdrageovereenkomst

Door een pull request in te dienen, ga je ermee akkoord dat je bijdragen worden gelicenseerd onder dezelfde licentie als het project ([Apache 2.0](../../LICENSE)).
