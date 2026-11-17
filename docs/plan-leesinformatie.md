# Plan — leesinformatie op het scherm (boeken en PDF's)

Opgesteld 2026-11-17 op verzoek van Eddie. Zes onderdelen, elk apart aan en uit te zetten, plus één
hoofdschakelaar. Gebaseerd op de code van `zeeneddie/speeedy` op commit `028caa2` + de lokale opschoning.

## Wat er nu al is

| Onderdeel | Stand | Waar |
|---|---|---|
| Voortgangsbalk over het hele document | aanwezig, aan/uit via `showProgress` | `rsvp-reader.ts` |
| Resterende tijd voor het hele document | aanwezig, altijd zichtbaar in de bediening | `rsvp-reader.ts:581`, `engine.getEstimatedRemainingMs` |
| Context bij pauze | aanwezig: `pauseView` = focus · context (±40 woorden) · volledige tekst; klik op een woord springt erheen | `rsvp-reader.ts:857` |
| Sessiecijfers | worden bewaard per sessie, alleen achteraf zichtbaar op de statistiekpagina | `ReadingSession` in `types.ts` |
| Pomodoro | aanwezig, met auto-pauze | `pomodoro*`-instellingen |
| **Pagina's en hoofdstukken** | **ontbreken**: PDF voegt alle pagina's samen (`text-parser.ts:181`), EPUB voegt alle hoofdstukken samen (`text-parser.ts:366`) | — |

Gevolg: onderdeel 1, de hoofdstukdelen van 2 en 3 en de kop in 4 hebben eerst een **fundament** nodig: de
structuur van het boek bewaren bij het inlezen.

## Instellingen

Alle nieuwe instellingen komen in `ReaderSettings` (`src/models/types.ts`) met een standaardwaarde in
`src/services/defaults.ts`. De lezer voegt bij het laden de standaardwaarden samen met het opgeslagen profiel
(`rsvp-reader.ts:169`), dus bestaande profielen krijgen de nieuwe sleutels vanzelf.

| Sleutel | Type | Standaard | Betekenis |
|---|---|---|---|
| `infoEnabled` | boolean | `true` | hoofdschakelaar: alles uit = de lezer zoals nu |
| `infoVisibility` | `"paused" \| "always"` | `"paused"` | alleen tonen bij pauze, of ook tijdens het lezen |
| `infoPosition` | `"top" \| "bottom"` | `"top"` | boven of onder het woord |
| `infoLocation` | boolean | `true` | 1 · waar ben ik |
| `infoLocationPage` | boolean | `true` | 1 · paginanummer tonen (alleen PDF) |
| `infoTimeLeft` | `"off" \| "chapter" \| "book" \| "both"` | `"both"` | 2 · resterende tijd |
| `infoTimeLeftUnit` | `"time" \| "words"` | `"time"` | 2 · als tijd of als aantal woorden |
| `infoProgress` | `"off" \| "book" \| "both"` | `"both"` | 3 · één balk (boek) of twee (hoofdstuk + boek) |
| `infoProgressPercent` | boolean | `true` | 3 · percentage erbij |
| `infoProgressMarks` | boolean | `true` | 3 · hoofdstukgrenzen als streepjes op de boekbalk |
| `infoPauseContext` | `"sentence" \| "paragraph" \| "page"` | `"paragraph"` | 4 · hoeveel context bij pauze |
| `infoPauseHeading` | boolean | `true` | 4 · kop van de huidige sectie bij pauze |
| `infoSession` | boolean | `false` | 5 · sessiecijfers |
| `intermezzoPlacement` | `"inline" \| "paragraph" \| "section"` | `"section"` | 6 · kader laten staan, na de alinea, of aan het eind van het (sub)hoofdstuk |
| `intermezzoMode` | `"read" \| "ask" \| "skip"` | `"ask"` | 6 · gewoon lezen · bij het begin vragen (lezen of overslaan) · altijd overslaan |

`infoVisibility = "paused"` is de standaard omdat alles op het scherm het oog van het spilpunt weghaalt.
Onderdeel 4 bestaat per definitie alleen bij pauze.

**Instellingenpaneel**: één nieuwe sectie *Leesinformatie* in `settings-panel.ts` met de hoofdschakelaar
bovenaan; de rest klapt in als de hoofdschakelaar uit staat. Bestaande `speeedy-toggle` en keuzelijsten
hergebruiken. **Sneltoets** `I`: hoofdschakelaar aan/uit tijdens het lezen. In gebruik zijn nu: spatie, pijltjes, `R`,
`F`, `?` en Escape (`rsvp-reader.ts`, `keyHandler`); `I` is vrij. Toevoegen aan de sneltoetsenlijst (`?`).

**Per boek**: later (besluit Eddie 2026-11-17), niet in dit plan.

---

## Fase 0 — Fundament: structuur bewaren bij het inlezen

**Datamodel.** `ParsedDocument` en `SavedDocument` krijgen een optioneel veld:

```ts
interface DocSection {
  title: string | null;   // hoofdstuktitel, null als onbekend
  page: number | null;    // PDF-paginanummer (1-based), null voor andere formaten
  text: string;           // de tekst van dit deel
}
sections?: DocSection[];   // ontbreekt bij oude documenten en formaten zonder structuur
```

`text` blijft bestaan als de samengevoegde tekst (achterwaarts compatibel: bibliotheek, ontdubbelen via
`contentHash`, oude documenten).

**Waarom delen bewaren en geen tekenposities**: de lezer bewerkt de tekst vóór het opdelen in woorden
(`removeCitations`, `rsvp-reader.ts:337`). Tekenposities zouden daardoor verschuiven. Door elk deel apart te
bewerken en op te delen, staat de woordpositie waar elk deel begint exact vast.

**Woordposities.** Bij het laden in de lezer: per deel bewerken en `tokenize` aanroepen, de aantallen
optellen → tabel `{ startWord, title, page }`. Controle: de som moet gelijk zijn aan het aantal woorden van
de samengevoegde tekst; zo niet, dan wordt de structuur genegeerd en vallen de onderdelen terug op
"boek"-niveau (nooit een verkeerd hoofdstuk tonen).

**Per formaat:**

| Formaat | Pagina's | Hoofdstukken | Hoe |
|---|---|---|---|
| PDF | ✔ | ✔ als de PDF een inhoudsopgave (outline) heeft | pagina-lus bestaat al (`text-parser.ts:139`) — per pagina een deel. Hoofdstukken via `pdf.getOutline()` + `getDestination`/`getPageIndex` → titel per beginpagina. Zonder outline: alleen pagina's |
| EPUB | — | ✔ | `nav.xhtml` (EPUB 3) of `toc.ncx` (EPUB 2) koppelt titels aan spine-bestanden; spine-lus bestaat al (`text-parser.ts:358`). Zonder inhoudsopgave: eerste `h1`/`h2` van elk spine-bestand |
| Markdown | — | ✔ | regels die met `#` beginnen |
| DOCX, HTML, ODT | — | later | besluit Eddie 2026-11-17: later, samen met de kaders in Word (fase 5) |
| TXT, RTF, CSV, plakken | — | — | geen structuur; onderdelen vallen terug op boekniveau |

**Opslag.** `sections` wordt mee opgeslagen in IndexedDB (`storage-service.ts`). Geen nieuwe `DB_VERSION`
nodig: het veld is optioneel. `isValidSavedDocument` blijft geldig voor documenten zonder het veld. Let op
de omvang: de tekst staat er dan in feite twee keer in → óf `text` afleiden uit `sections` bij het laden, óf
alleen `{ title, page, length }` per deel opslaan. Keuze bij de bouw, met meting van een groot boek.

**Tests** (Vitest, bestaande fixtures `test-fixtures/sample.epub` en de PDF):
- PDF: aantal delen = aantal pagina's; hoofdstukken uit de outline.
- EPUB: titels uit de inhoudsopgave in de goede volgorde.
- De som van de woorden per deel = het aantal woorden van de samengevoegde tekst, met en zonder `removeCitations`.
- Een oud document zonder `sections` laadt en leest zoals nu.

---

## Fase 1 — Onderdeel 5: deze sessie *(geen fundament nodig)*

**Toont**: actieve leestijd van deze sessie · woorden gelezen in deze sessie · werkelijke gemiddelde
snelheid (gelezen woorden ÷ actieve tijd, dus inclusief de pauzes tussen zinnen, exclusief pauzeren).

**Bron**: `PlaybackState.elapsedMs` en het woord waar de sessie begon; dezelfde berekening als bij het
opslaan van de sessie (`rsvp-reader.ts:443`) — één hulpfunctie voor beide, zodat ze niet uit elkaar lopen.

**Pauzes**: geen eigen herinnering — daarvoor is de bestaande Pomodoro (besluit Eddie 2026-11-17).

**Tests**: werkelijke snelheid bij een vaste reeks speel/pauzeer-momenten (nep-klok).

## Fase 2 — Onderdelen 1, 2 en 3 *(na fase 0)*

**1 · Waar ben ik.** Regel als *"Hfdst. 4 · De markt — p. 87/312"*. Lange titels afkappen met `…`
(volledige titel als tooltip). Zonder hoofdstukken: alleen de pagina; zonder beide: regel verborgen.

**2 · Resterende tijd.** Hoofdstuk: woorden tot `startWord` van het volgende deel, omgerekend met dezelfde
methode als `getEstimatedRemainingMs` (die rekent met de pauzevermenigvuldigers per woord; uitbreiden met
een `untilWord`-parameter in plaats van een tweede berekening ernaast). Boek: de bestaande waarde. Eenheid
tijd of woorden. De bestaande "… left" in de bediening gaat over in deze weergave als onderdeel 2 aan staat,
zodat het niet twee keer op het scherm staat.

**3 · Voortgang op twee niveaus.** Dunne hoofdstukbalk boven de bestaande boekbalk; percentage ernaast;
streepjes op de boekbalk bij elke `startWord`. Klikken op een streepje = `engine.seekToWord(startWord)` (bestaat
al, `rsvp-engine.ts:290`). Bestaande `showProgress` blijft de schakelaar voor de boekbalk zelf; `infoProgress`
regelt de extra's — bij de bouw nagaan of die twee samen te voegen zijn zonder bestaande profielen te breken.

**Tests**: hoofdstukgrens precies op `startWord`; resterende hoofdstuktijd daalt monotoon tijdens lezen;
klik op streepje springt naar het juiste woord; alles verborgen bij documenten zonder structuur.

## Fase 3 — Onderdeel 4: context bij pauze

Bouwt op de bestaande `pauseView = "context"` (`rsvp-reader.ts:864`), die nu vast ±40 woorden toont.

- **Omvang**: in plaats van ±40 woorden de hele **zin**, **alinea** of **pagina** rond het huidige woord.
  Zinsgrenzen: woorden die eindigen op `.`, `!` of `?` (dezelfde regel als de zinspauze in de engine);
  alineagrenzen: `context.paragraphStart` (bestaat al per woord); paginagrenzen: uit fase 0.
- **Kop**: titel van de huidige sectie boven de context (uit fase 0).
- **Terugspringen**: twee knoppen en sneltoetsen — *één zin terug*, *één alinea terug*. Naast de bestaande
  terugspoelstap in woorden (`rewindStep`). Sneltoetsen kiezen die nog vrij zijn.
- Het huidige woord blijft gemarkeerd en klikbaar zoals nu.

**Tests**: zin- en alineagrenzen op teksten met afkortingen ("dr.", "bijv.") — bekende valkuil, vastleggen
wat er gebeurt; terugknoppen landen op het eerste woord van de vorige zin/alinea.

---

## Fase 4 — Onderdeel 6: kaders als intermezzo (PDF) *(na fase 0)*

Kaders met tekst (een voorbeeld, een definitie, een citaat in een gekleurd blok) onderbreken nu midden in
een zin de lopende tekst. Doel: het kader **verplaatsen** naar het eind van de alinea of het (sub)hoofdstuk,
het **duidelijk aankondigen** als intermezzo, en het **over kunnen slaan**.

**Kan het?** Ja, maar in een PDF niet altijd zeker. Een PDF kent geen "kader"; er staan alleen tekst en
getekende vormen op een pagina. Herkennen gaat met een combinatie van signalen, per pagina:

| Signaal | Hoe (pdf.js) | Betrouwbaarheid |
|---|---|---|
| Getekende rechthoek (rand of achtergrondkleur) die een groep tekst omsluit | `page.getOperatorList()`: rechthoeken en vlakvullingen met hun positie; tekstposities uit `getTextContent()` (die gebruiken we al) | goed bij boeken met omlijnde of gekleurde kaders |
| Tekstblok smaller dan of naast de hoofdkolom | x-positie en breedte van de regels t.o.v. de rest van de pagina | redelijk; verwarring met kolommen en tabellen |
| Ander lettertype of andere lettergrootte dan de lopende tekst | `fontName` en grootte per tekststuk | ondersteunend, niet genoeg alleen |
| Gelabelde PDF met een `Aside`/`Note`-label | `page.getStructTree()` | zeker, maar weinig PDF's zijn zo gelabeld |

**Regel: liever niets dan fout.** Alleen als minstens twee signalen samenvallen (of een label zeker is)
wordt een blok een intermezzo. Twijfel → de tekst blijft waar hij staat, zoals nu. Wat herkend is, is
zichtbaar te maken in de pauzeweergave (kader-markering), zodat een gemiste of foute herkenning op te merken is.

**Verplaatsen.** Het kader gaat als apart deel (`DocSection` met `kind: "intermezzo"`) naar:
- `"paragraph"`: na de alinea waarin het kader stond;
- `"section"` (standaard): aan het eind van het (sub)hoofdstuk. Subhoofdstukken alleen als de PDF-inhoudsopgave
  ze kent (diepere niveaus van de outline); anders het hoofdstuk, anders het eind van de pagina;
- `"inline"`: niet verplaatsen, wel markeren.

Een kader dat over een paginagrens doorloopt, wordt samengevoegd als het op de volgende pagina op dezelfde
plek en in dezelfde vorm doorgaat; anders twee losse intermezzo's.

**Aankondigen.** Vóór het eerste woord een aankondiging van ±1 seconde: *"Intermezzo — ‹eerste regel of
kop van het kader› · ±40 s"*. Tijdens het intermezzo: andere achtergrondtint en een smalle balk opzij, zodat
duidelijk is dat het geen lopende tekst is. Na het intermezzo een korte overgang terug.

**Overslaan.**
- `intermezzoMode = "ask"` (standaard): bij de aankondiging stopt het lezen; spatie = lezen, `S` = overslaan.
- `"read"`: aankondigen en doorlezen; `S` slaat het lopende intermezzo alsnog over.
- `"skip"`: intermezzo's altijd overslaan; ze blijven bereikbaar via de pauzeweergave.
- Overslaan = `engine.seekToWord(eindwoord + 1)` (bestaat al). Resterende tijd (onderdeel 2) toont het
  intermezzo apart: *"6 min · + 1 min intermezzo's"*.
- `S` is nog vrij (zie de sneltoetsenlijst hierboven).

**Eerst een proef (½ dag) vóór de bouw**: de herkenning draaien op de PDF in `test-fixtures/` en op twee à
drie eigen boeken met kaders; per boek tellen: gevonden kaders · terecht · gemist · ten onrechte. Pas bouwen
als het aantal ten onrechte herkende kaders bij nul ligt; gemiste kaders zijn acceptabel (die blijven gewoon staan).

**Tests**: herkenning op vaste fixtures (een PDF met omlijnd kader, een met gekleurd vlak, een met twee kolommen
zonder kader → níet herkennen); verplaatsing naar alinea- en hoofdstukeind; overslaan landt op het eerste woord
na het intermezzo; woordtelling klopt nog (fase 0-controle).

## Fase 5 — Word-documenten *(later, besluit Eddie 2026-11-17)*

DOCX krijgt dan koppen (hoofdstukken) én kaders. Daar is het eenvoudiger dan in PDF: een tekstvak staat in
de bron als apart element (`w:txbxContent`), dus herkennen is zeker in plaats van een schatting. Na te gaan
bij de bouw: of `mammoth` (de huidige DOCX-lezer) tekstvakken los aanlevert of in de lopende tekst zet; zo
niet, het documentbestand zelf lezen met JSZip (zit al in speeedy).

## Volgorde en omvang (schatting)

| Fase | Inhoud | Hangt af van | Omvang |
|---|---|---|---|
| 0 | structuur bewaren (PDF, EPUB, Markdown) + opslag + tests | — | 1,5–2 dagen |
| 1 | instellingenblok + hoofdschakelaar + onderdeel 5 | — | 1 dag |
| 2 | onderdelen 1, 2, 3 | fase 0, 1 | 1,5 dagen |
| 3 | onderdeel 4 | fase 0, 1 | 1 dag |
| 4 | onderdeel 6: kaders in PDF — eerst proef ½ dag, daarna bouwen | fase 0 | ½ + 2 dagen |
| 5 | Word: koppen en kaders | fase 0, 4 | later |

Fase 0 en 1 kunnen naast elkaar. Elke fase = één PR op `zeeneddie/speeedy`, met unit-tests en een
browsertest die de hoofdschakelaar uit zet en controleert dat de lezer er dan uitziet als nu.

## Randvoorwaarden

- **Alles uit = de lezer van nu.** De browsertests van vandaag blijven groen met `infoEnabled = false`.
- **Geen gegevens naar buiten.** Alles wordt berekend in de browser; niets nieuws over het netwerk.
- **Liever niets dan fout.** Kan een hoofdstuk of pagina niet zeker worden vastgesteld, dan niet tonen.
- **Oude documenten** zonder structuur blijven werken; opnieuw importeren geeft ze structuur.

## Besluiten Eddie 2026-11-17

1. Standaardwaarden akkoord: alleen tonen bij pauze; sessiecijfers uit.
2. Geen eigen pauzeherinnering — alleen Pomodoro.
3. DOCX (en HTML/ODT) later.
4. Instellingen per boek later.
5. Kaders in PDF en Word: verplaatsen naar het eind van de alinea of het (sub)hoofdstuk, aankondigen als
   intermezzo, en kunnen overslaan (onderdeel 6).

## Open punten

- Proef kaderherkenning (fase 4): welke boeken met kaders gebruiken we als testmateriaal? Liefst eigen
  of vrij te gebruiken PDF's; geen klantdocumenten.
