# Plan — samenvatting en beoordeling

Opgesteld 2026-11-18 op verzoek van Eddie. **Status: in de wachtrij** (apart plan, besluit 2026-11-18).

## Wat het wordt

Bij elk gelezen document in de bibliotheek een **aanhangsel**:

1. **Een samenvatting**, per hoofdstuk en voor het geheel: serieus, in nette zinnen, **zonder verzinsels**, met de
   **marks** van de lezer erin.
2. **Een beoordeling:** duim omhoog of omlaag en een **cijfer van 1 tot 10**, voor het document én per hoofdstuk.

Zo zie je in het overzicht snel wat goed en wat slecht is aan een tekst.

Besluiten Eddie 2026-11-18:
- de samenvatting wordt **geschreven door AI (Claude)**, niet alleen uit de tekst geknipt;
- cijfer **1–10**;
- beoordelen **per document én per hoofdstuk**;
- **apart plan**;
- model **Opus**; samenvatting in **de taal van het document**;
- via **ons Claude Max-abonnement (Max 20)**, zoals PO-Companion dat al doet: de `claude`-opdrachtregel (Claude Code)
  op de server, zonder API-sleutel (`mq-PO-Companion/mq_brain/llm_adapters.py`).

## Zonder verzinsels: hoe

Een samenvatting in eigen woorden kan iets beweren wat niet in de tekst staat. Daarom geldt: **elke zin van de
samenvatting moet een bronverwijzing hebben naar de passage waar hij op steunt**, en een zin zonder **gecontroleerde**
bron wordt niet getoond.

- **Eigen bronverwijzingen** (de citatiefunctie van de API is er niet via de opdrachtregel). Het hoofdstuk gaat naar
  Claude als **genummerde alinea's** (`[A12] …`). Claude antwoordt met per zin: de zin, het alineanummer en de
  **letterlijke passage** waarop hij steunt.
- **Controle in speeedy** voordat iets getoond wordt:
  - een zin zonder alineanummer of passage → weggelaten;
  - de passage moet **letterlijk** in die alinea staan (vergelijken na normaliseren van spaties, aanhalingstekens en
    afbreekstreepjes) → anders weggelaten;
  - een antwoord dat niet te lezen is → het hoofdstuk krijgt "samenvatting mislukt, opnieuw proberen";
  - bij elk hoofdstuk staat hoeveel zinnen bleven en hoeveel er vielen.
- **Plek tot op de zin.** Speeedy weet van elke alinea bij welk woord die begint; de passage wordt binnen de alinea
  opgezocht. Een verwijzing wordt zo een exacte plek in de lezer en in het tabblad *Origineel*.
- **Opdracht aan het model:** samenvatten in nette, zakelijke zinnen, **in de taal van het document**; alleen wat in de
  tekst staat; geen eigen oordeel, geen achtergrondkennis, geen aanbevelingen. De zinnen die de lezer gemarkeerd heeft,
  gaan mee als aanwijzing "deze passages vond de lezer belangrijk"; de samenvatting moet ze dekken.
- **Tekst en opdracht gescheiden.** De documenttekst staat tussen begrenzers met een **willekeurige code per aanroep**
  (zoals `_stdin_envelop` in PO-Companion), zodat tekst in een document zich niet als opdracht kan voordoen. De
  controle hierboven vangt het daarna nog eens af: alles wat getoond wordt, staat letterlijk in de tekst.

## Model, gebruik en privacy

- **Via de opdrachtregel:** `claude -p --output-format text --model opus`, de opdracht en de tekst via **stdin** (niet
  als argument: dat is zichtbaar voor andere gebruikers op de server), met een tijdslimiet per aanroep — hetzelfde
  patroon als `_call_claude_cli` in PO-Companion.
- **Geen kosten per token**, wel de **gebruikslimieten van Max 20** (per tijdvenster). Een heel boek is ruwweg
  160.000 tokens; daarom gaan hoofdstukken in een **wachtrij**, één of twee tegelijk. Loopt het venster vol, dan
  wacht de rij en toont speeedy "wacht op gebruikslimiet, gaat verder om hh:mm". De korting voor batchverwerking van
  de API geldt niet voor het abonnement.
- **Voorwaarde:** op de P620 staat `claude` geïnstalleerd en ingelogd met het Max-account.
- **Privacy:** de tekst gaat naar Anthropic (via het abonnement). Daarom:
  - alleen op een **knop** per document (*Maak samenvatting*), nooit automatisch;
  - een melding bij de eerste keer: "De tekst van dit document gaat naar Claude (Anthropic) om de samenvatting te maken";
  - geen opslag van teksten of samenvattingen in de dienst.
- **Anonimiseren:** PO-Companion haalt elke prompt door een anonimiseringspoort (klantdata). Voor speeedy (eigen
  leesstof: boeken, artikelen) staat dat niet vast — open punt 1.

## Fase 0 — Beoordeling (zonder AI, kan eerst)

- **Per document:** duim omhoog/omlaag + cijfer 1–10, met datum; aan te passen of te wissen.
- **Per hoofdstuk:** hetzelfde, bij elk item van de inhoudsopgave (uit fase 0 van *voortgang en inhoud*).
- **Opslag:** bij het document (`rating`, en `rating` per item van de inhoudsopgave), in de bestaande store.
- **Bibliotheek:** duim en cijfer zichtbaar per document; **sorteren** op cijfer en **filteren** ("alleen 👍",
  "cijfer ≥ 7"); bij uitklappen per hoofdstuk het cijfer.
- **In de lezer:** na *volledig gelezen* (of bij het afsluiten van een hoofdstuk) een korte vraag om een cijfer —
  in te stellen of uit te zetten.

## Fase 1 — Samenvattingsdienst op de P620

- **Dienst** naast speeedy (zelfde Docker-container als de ophaaldienst uit het plan *webpagina's*):
  `POST /summarize` met per hoofdstuk de genummerde alinea's (tekst + beginwoord), de gemarkeerde zinnen en de taal.
- **Aanroep:** `claude -p --output-format text --model opus` via stdin, tijdslimiet per hoofdstuk; tekst en opdracht
  gescheiden met een code per aanroep. Patroon en lessen overnemen uit `mq_brain/llm_adapters.py` (PO-Companion),
  niet die code kopiëren: speeedy is TypeScript, de dienst krijgt een eigen kleine adapter.
- **Wachtrij** per hoofdstuk, één tot twee tegelijk; stopt netjes bij de gebruikslimiet en gaat later verder.
- **Toegang:** alleen voor wie speeedy op de server mag gebruiken.
- **Geen opslag** in de dienst: het resultaat gaat terug naar de browser en wordt daar bij het document bewaard.
- **Controle** (zie boven) gebeurt in speeedy zelf, niet in de dienst, zodat ook een fout in de dienst nooit een zin
  zonder gecontroleerde bron oplevert.

## Fase 2 — Het aanhangsel in bibliotheek en lezer

- **Bibliotheek:** per document *Samenvatting* uitklappen:
  - per hoofdstuk de samenvatting, de marks van dat hoofdstuk (letterlijk, gemarkeerd), en de beoordeling;
  - elke zin met een klein bronnummer; klik = de passage in het tabblad *Origineel* (pdf, webpagina) of in de lezer;
  - bovenaan de datum van maken, het model en "x zinnen zonder bron weggelaten".
- **In de lezer:** in de inhoudsopgave links (fase 2 van *voortgang en inhoud*) per hoofdstuk een knop om de
  samenvatting te zien.
- **Opnieuw maken** kan (bijvoorbeeld na nieuwe marks); de vorige versie wordt vervangen.

## Fase 3 — Samenvatting van het geheel

- Uit de **hoofdstuksamenvattingen** (die al bronnen hebben) een korte samenvatting van het hele document; elke zin
  verwijst naar de hoofdstukzinnen waarop hij steunt, en zo naar de tekst.
- Voor documenten zonder hoofdstukken (artikelen, webpagina's): één samenvatting, per alinea met bronnen.

## Tests

- Controle: zin zonder verwijzing → weggelaten en geteld; verwijzing met tekst die niet in de alinea staat → weggelaten.
- Bronnummer leidt naar het juiste woord in de lezer en de juiste plek in het origineel.
- Beoordeling: opslaan, wijzigen, wissen; sorteren en filteren in de bibliotheek; per hoofdstuk.
- Dienst: tekst via stdin, nooit in argv; begrenzer met code per aanroep; tijdslimiet; gebruikslimiet bereikt →
  wachtrij pauzeert en meldt het; geen tekst in de logs.
- **Geen echte Claude-aanroepen in de tests**: de aanroep van `claude` wordt nagebootst met opgenomen antwoorden
  (zoals in PO-Companion; besluit 2026-08-31 "geen echte LLM-aanroepen in de testpoort").

## Volgorde en omvang (schatting)

| Fase | Inhoud | Omvang | Voorwaarde |
|---|---|---|---|
| 0 | beoordeling per document en hoofdstuk, bibliotheek sorteren/filteren | 1–1,5 dag | inhoudsopgave (PR #4) |
| 1 | samenvattingsdienst via `claude -p`, wachtrij, controle | 1,5–2 dagen | speeedy op de P620, `claude` ingelogd met Max |
| 2 | aanhangsel in bibliotheek en lezer, bronnen klikbaar | 1,5 dag | fase 1; zijbalk uit *voortgang en inhoud* fase 2 |
| 3 | samenvatting van het geheel | 1 dag | fase 2 |

## Open punten voor Eddie

Besluiten 2026-11-18: model Opus; taal van het document; via het Max 20-abonnement met de `claude`-opdrachtregel,
zoals PO-Companion.

1. Anonimiseren: moet de tekst, zoals in PO-Companion, eerst door de anonimiseringspoort (namen, plaatsen)? Voor
   eigen leesstof lijkt dat niet nodig, en het kan de samenvatting minder leesbaar maken; bij klantdocumenten wel.
