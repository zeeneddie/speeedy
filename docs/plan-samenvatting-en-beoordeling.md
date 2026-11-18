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
- **apart plan**.

## Zonder verzinsels: hoe

Een samenvatting in eigen woorden kan iets beweren wat niet in de tekst staat. Daarom geldt: **elke zin van de
samenvatting moet een bronverwijzing hebben naar de passage waar hij op steunt**, en een zin zonder bron wordt
niet getoond.

- **Citations van de Claude API** (algemeen beschikbaar, geen beta): het hoofdstuk gaat mee als *document* met
  `citations: {enabled: true}`. Het antwoord komt terug in tekstblokken; elk blok met een bewering draagt een lijst
  `citations` met de letterlijk geciteerde tekst (`cited_text`) en de plek.
- **Plek tot op de zin.** Het hoofdstuk wordt aangeleverd als document met **eigen inhoudsblokken: één blok per
  alinea** (`content_block_location`). Speeedy weet van elke alinea bij welk woord die begint, dus een verwijzing
  wordt een exacte plek in de lezer en in het tabblad *Origineel*.
- **Controle in speeedy** voordat iets getoond wordt:
  - een zin zonder verwijzing → weggelaten en geteld ("2 zinnen zonder bron weggelaten");
  - de geciteerde tekst moet letterlijk in die alinea staan (normaliseren op spaties en leestekens) → anders weggelaten;
  - bij het hoofdstuk staat hoeveel zinnen er bleven en hoeveel er vielen.
- **Opdracht aan het model:** samenvatten in nette, zakelijke zinnen; alleen wat in de tekst staat; geen eigen
  oordeel, geen achtergrondkennis, geen aanbevelingen. De zinnen die de lezer gemarkeerd heeft, gaan mee als
  aanwijzing "deze passages vond de lezer belangrijk"; de samenvatting moet ze dekken.
- Een **gestructureerd antwoord** (`output_config.format`) kan niet samen met citations (de API weigert die
  combinatie); de samenvatting komt daarom als tekst met verwijzingen, en speeedy verwerkt die.

## Model, kosten en privacy

- **Model:** `claude-opus-5-5` (de huidige standaard van Anthropic; $4 per miljoen tokens invoer, $20 uitvoer;
  invoer uit de cache $0,20). Denkwerk kan op dit model niet uit; de diepte gaat via `effort` (standaard `medium`;
  voor samenvatten volstaat `low` of `medium` — te meten op een paar hoofdstukken). Een goedkoper model kiezen is
  aan Eddie (open punt 1), niet stilzwijgend.
- **Weigeringen:** het model kan een verzoek weigeren (`stop_reason: "refusal"`). Speeedy controleert dat altijd;
  de dienst zet de standaard terugvaloptie van de API aan (`fallbacks: "default"`), zodat een ander model het dan
  overneemt.
- **Kosten (schatting, vóór meting):** een boek van 300 pagina's is ruwweg 160.000 tokens invoer → circa $0,65
  invoer + $0,20 uitvoer ≈ **$0,85 per boek**; een artikel van 5.000 woorden ≈ **$0,03**. Hele boeken in één keer
  via de **Batches API**: de helft van de prijs, resultaat binnen enkele uren.
- **Privacy:** de tekst gaat naar Anthropic. Daarom:
  - alleen op een **knop** per document (*Maak samenvatting*), nooit automatisch;
  - een melding bij de eerste keer: "De tekst van dit document gaat naar Claude (Anthropic) om de samenvatting te maken";
  - de API-sleutel staat **alleen op de server** (P620), nooit in de browser; geen opslag van teksten in de dienst.

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
  `POST /summarize` met per hoofdstuk de alinea's (tekst + beginwoord), de gemarkeerde zinnen en de taal.
- **Per hoofdstuk één verzoek** met citations; hoofdstukken parallel (begrensd). Lange hoofdstukken passen ruim in
  het venster van 1 miljoen tokens; niets wordt ingekort.
- **Prompt caching** op het document-blok als er meer verzoeken over hetzelfde hoofdstuk volgen (bijvoorbeeld
  opnieuw maken met andere marks).
- **Sleutel** uit de geheimenkluis van de server, niet in de code of de container-image.
- **Toegang:** alleen voor wie speeedy op de server mag gebruiken; maximaal aantal verzoeken per dag (kostenrem).
- **Geen opslag** in de dienst: het resultaat gaat terug naar de browser en wordt daar bij het document bewaard.

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
- Dienst: geen sleutel in de browser of de image; weigering (`refusal`) netjes afgehandeld; kostenrem werkt;
  geen tekst in de logs.
- Tests met de API gebruiken opgenomen antwoorden (geen echte aanroepen in de test).

## Volgorde en omvang (schatting)

| Fase | Inhoud | Omvang | Voorwaarde |
|---|---|---|---|
| 0 | beoordeling per document en hoofdstuk, bibliotheek sorteren/filteren | 1–1,5 dag | inhoudsopgave (PR #4) |
| 1 | samenvattingsdienst met citations en controle | 1,5–2 dagen | speeedy op de P620, API-sleutel |
| 2 | aanhangsel in bibliotheek en lezer, bronnen klikbaar | 1,5 dag | fase 1; zijbalk uit *voortgang en inhoud* fase 2 |
| 3 | samenvatting van het geheel | 1 dag | fase 2 |

## Open punten voor Eddie

1. Model: `claude-opus-5-5` (standaard, beste kwaliteit) of het goedkopere `claude-sonnet-5-5` (circa de helft)?
2. Taal van de samenvatting: altijd Nederlands, of de taal van het document?
3. API-sleutel: een aparte sleutel voor speeedy (eigen kostenoverzicht en limiet), of de bestaande?
