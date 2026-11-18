# Plan — tabblad "Origineel" naast het snellezen

Opgesteld 2026-11-18 op verzoek van Eddie. Basis: speeedy zoals het nu is (`zeeneddie/speeedy`, commit `4ec1c12`).
Bijgewerkt 2026-11-18: fase 0 gebouwd (PR #1); fase 1 en 2 samengevoegd; marks toegevoegd (nieuwe fase 2).

## Wat het wordt

In de lezer komen twee tabbladen voor **hetzelfde document**:

- **Snellezen** — het bestaande scherm, woord voor woord.
- **Origineel** — het document zoals het er echt uitziet (pdf met eigen opmaak, kaders, plaatjes).

Het origineel **loopt mee**: het staat op de pagina die je aan het lezen bent, met het huidige woord gemarkeerd.
**Klik je op een woord** in het origineel, dan gaat het snellezen vanaf dat woord verder. Eerst alleen voor pdf;
de opzet laat ruimte voor EPUB en Word later.

**Marks.** Tijdens het snellezen zet je met één toets een mark bij de zin waar je bent. Die marks zie je terug
in het origineel, op de plek waar die zin in de pdf staat, en in een lijst waarmee je naar elke gemarkeerde zin
springt. Zo stip je tijdens het snellezen aan wat je later in het origineel rustig wilt nalezen.

Besluiten Eddie 2026-11-18:
- tab binnen speeedy · meelopen · terugspringen door te klikken · eerst pdf, ruimte voor uitbreiding;
- overschakelen pauzeert het lezen · zowel tabbladen als een gesplitst scherm moeten mogelijk zijn;
- geen vaste grens van 50 MB meer, wel een controle op opslagruimte en een instelbare bovengrens (standaard 500 MB);
- **marks**: een mark = de zin waar je bent · zetten met `M` zonder te stoppen · zichtbaar in speeedy (puntje in
  de kantlijn, zin gemarkeerd in het origineel) · een lijst van marks om naar te springen · later eventueel de
  pdf mét marks downloaden;
- fase 1 en 2 samen bouwen, omdat marks de precieze plek op de pagina nodig hebben.

## Hoe speeedy het nu doet

| Onderdeel | Stand | Waar |
|---|---|---|
| Pdf inlezen | tekst per pagina (`pages`) en het bestand zelf worden bewaard (fase 0) | `text-parser.ts` (`parsePdf`) |
| Originelen | store `originals` in IndexedDB (versie 3), per document-id | `storage-service.ts` |
| Paginagrenzen | `computePageStarts` / `pageForWord`: bij welk woord elke pagina begint | `page-map.ts` |
| Bibliotheek | max. 20 documenten; de oudste wordt automatisch opgeruimd | `storage-service.ts` (`pruneDocuments`) |
| Springen naar een woord | `engine.seekToWord(index)` | `rsvp-engine.ts:290` |
| Volledige tekst bij pauze | uitgelezen tekst zonder opmaak; klik op een woord springt erheen | `rsvp-reader.ts:857` |
| Pdf tonen | pdf.js (`pdfjs-dist` 5.5) met viewer-onderdelen (`pdfjs-dist/web`), `cmaps` en `standard_fonts` | `package.json` |
| Sneltoetsen in gebruik | spatie, pijltjes, `R`, `F`, `?`, Escape | `rsvp-reader.ts` (`keyHandler`) |

---

## Fase 0 — Origineel bewaren en paginagrenzen vastleggen ✅

Gebouwd en gemerged op 2026-11-18 ([PR #1](https://github.com/zeeneddie/speeedy/pull/1)):

- pdf-import bewaart de tekst per pagina en het bestand zelf; de afgespeelde tekst is ongewijzigd;
- IndexedDB versie 3 met store `originals`; opgeruimd bij verwijderen en bij het opruimen boven 20 documenten;
- opslagcontrole vooraf; past het niet, dan tekst zonder origineel, met melding;
- `page-map.ts`: bij welk woord elke pagina begint, gecontroleerd tegen het totaal (anders `null`);
- importgrens = instelling `maxImportBytes`, standaard 500 MB;
- tests: opslag, paginagrenzen, en een browsertest op de test-pdf inclusief citatenfilter en upgrade 2 → 3.

## Fase 1 — Tabblad Origineel: weergave, meelopen, woordmarkering, klikken ✅

Voorheen fase 1 en 2, nu samen gebouwd. Gemerged op 2026-11-18 ([PR #2](https://github.com/zeeneddie/speeedy/pull/2)).
Afwijking: klikken gaat via een eigen laag met de woordposities, niet via de `TextLayer` van pdf.js; na een klik
start de lezer niet vanzelf (spatie).

**Tabbladen.** Bovenaan de lezer twee tabs: *Snellezen* · *Origineel*. Sneltoets `O` om te wisselen.
Overschakelen naar *Origineel* **pauzeert** het lezen; terug naar *Snellezen* gaat verder waar je was, of waar
je in het origineel op klikte. Documenten zonder origineel (oude documenten, andere formaten, opslag vol): het
tabblad staat uitgegrijsd met de uitleg "Importeer het bestand opnieuw om het origineel te zien".

**Weergave.** Pdf-pagina's tekenen met pdf.js (`PDFPageProxy.render` op een canvas) plus de tekstlaag
(`TextLayer`), zodat tekst aan te klikken is. Alleen de pagina's in beeld worden getekend (en één ervoor en
erna), zodat grote boeken snel blijven. Zoomen: passend op breedte, plus en min.

**Meelopen.** Bij het openen springt de weergave naar de pagina van het huidige woord (`pageForWord`). Bladeren
kan vrij; een knop *Terug naar mijn plek* brengt je weer naar de huidige pagina.

**Van woord naar plek.** Per pagina de woorden uit de lezer naast de tekststukken van de pdf leggen (pdf.js
levert per stuk de tekst en de positie). Beide reeksen worden genormaliseerd (kleine letters; leestekens,
spaties en afbreekstreepjes weg) en op volgorde gekoppeld. Woorden die de lezer niet heeft (weggefilterde
citaties) of die de pdf anders opdeelt (zoals `[1]`, dat de lezer als `here[` + `1]` splitst) worden overgeslagen
of samengevoegd. Resultaat: per woord een rechthoek op de pagina, of geen.

**Huidig woord markeren.** Het huidige woord krijgt een gekleurd vlak op die plek. Lukt de koppeling voor dat
woord niet, dan wordt alleen de pagina gemarkeerd — **liever niets dan een verkeerd woord**.

**Klikken om verder te lezen.** Klik op een woord → het dichtstbijzijnde gekoppelde woord →
`engine.seekToWord(index)` → terug naar *Snellezen*, met de bestaande aftelling (`countdownEnabled`) als die aan
staat. De voortgang wordt opgeslagen zoals nu (`persistProgress`).

**Geen gegevens naar buiten.** `cMapUrl` en `standardFontDataUrl` wijzen naar bestanden in de eigen build
(gekopieerd uit `node_modules/pdfjs-dist/cmaps` en `standard_fonts`). Geen CDN.

**Laden op afroep.** De weergavecode wordt pas geladen als iemand het tabblad opent (dynamische `import`).

**Tests**
- Tabblad opent op de juiste pagina voor een woord midden in de test-pdf; wisselen pauzeert.
- Koppeling op de test-pdf: aandeel gekoppelde woorden per pagina gemeten; op een steekproef nul verkeerde.
- Klik op een woord landt op hetzelfde woord in de lezer.
- Woord zonder koppeling → alleen paginamarkering.
- In de build geen verwijzingen naar externe adressen.

## Fase 2 — Marks

**Een mark zetten.** Tijdens het lezen druk je `M` (nu vrij). Het lezen gaat door; een kort puntje naast het
woord bevestigt dat de mark staat. De mark omvat **de zin** waar het huidige woord in staat: van het eerste
woord na het vorige zinseinde tot en met het woord met `.`, `!` of `?` (dezelfde regel als de zinspauze in de
engine). Nog een keer `M` in dezelfde zin = de mark weer weghalen. Ook bij pauze en in de weergave *volledige
tekst* werkt `M` op de zin van het huidige woord.

**Wat er wordt bewaard.** Per mark:

```ts
interface Mark {
  id: string;
  createdAt: string;
  page: number | null;     // pdf-pagina (0-based), null zonder paginagrenzen
  startWord: number;       // eerste woord van de zin
  endWord: number;         // laatste woord van de zin
  prep: "plain" | "noCitations"; // met welke tekstbewerking de woordnummers gelden
  quote: string;           // de zin zelf, om de plek terug te vinden
}
// SavedDocument krijgt: marks?: Mark[]
```

De woordnummers hangen af van het citatenfilter (`removeCitations`): met het filter aan zijn er minder woorden.
Staat het filter bij het openen anders dan bij het zetten, dan wordt de plek teruggevonden via `quote` binnen
`page`. Lukt dat niet, dan staat de mark wel in de lijst, met de pagina en de melding "plek niet gevonden".

**Bewaren.** Marks horen bij het document en gaan mee in de bestaande store `documents` (geen nieuwe
databaseversie). Ontdubbelen houdt ze vast: hetzelfde document opnieuw importeren behoudt de marks.
**Documenten met marks worden niet automatisch opgeruimd** bij meer dan 20 documenten; marks zijn eigen werk en
mogen niet ongemerkt verdwijnen. Verwijderen doe je dan zelf.

**Zien in het origineel.** In het tabblad *Origineel*:
- de gemarkeerde zin krijgt een zachte achtergrondkleur (de rechthoeken van de woorden uit fase 1);
- in de kantlijn staat een puntje ter hoogte van de zin;
- op een pagina zonder woordkoppeling: alleen het puntje in de kantlijn bovenaan de pagina.

**Zien bij het snellezen.** In de voortgangsbalk een klein streepje per mark; in de weergave *volledige tekst*
bij pauze de gemarkeerde zinnen met dezelfde achtergrondkleur.

**De lijst van marks.** Een knop *Marks (n)* in de lezer opent een lijst: pagina · eerste woorden van de zin ·
datum. Per mark:
- klik → naar de zin in het **origineel** (tabblad *Origineel*, juiste pagina, zin in beeld);
- *Hier verder lezen* → snellezen vanaf het begin van die zin;
- *Verwijderen*.

**Tests**
- `M` zet een mark op de juiste zin (begin- en eindwoord), ook midden in een zin; nog een keer `M` haalt hem weg.
- De mark staat na herladen nog op dezelfde plek.
- Citatenfilter omzetten na het zetten → de mark wordt via de zin teruggevonden.
- Document met marks wordt niet opgeruimd bij meer dan 20 documenten.
- In het origineel staat de markering op de juiste zin van de test-pdf; klik in de lijst opent de juiste pagina.

## Fase 3 — Gesplitst scherm

Naast de tabbladen een tweede weergave: snellezen en origineel **naast elkaar** (`originalLayout = "split"`).

- Het origineel loopt **tijdens het lezen** mee: de pagina en het gemarkeerde woord volgen de lezer. Om het oog
  niet af te leiden, schuift de weergave per alinea of per pagina op, niet per woord (instelling, standaard per alinea).
- Een mark die je met `M` zet, verschijnt direct in het origineel ernaast.
- Klikken op een woord in het origineel pauzeert, springt naar dat woord en gaat verder na de aftelling.
- Verdeling instelbaar met een sleepbare scheidslijn; op smalle schermen (telefoon) staat het origineel onder
  het woord, of valt de weergave terug op tabbladen.
- Wisselen tussen tabbladen en gesplitst scherm met een knop in de lezer; `O` blijft in beide het origineel
  tonen of verbergen.
- Prestaties: het origineel wordt bijgewerkt buiten de woordtimer om (`requestAnimationFrame`), en alleen als de
  pagina of alinea verandert.

**Tests**: het origineel loopt mee zonder dat de woordtiming verschuift (gemeten tegen de lezer zonder
origineel); klik landt op het juiste woord; op een smal scherm valt de weergave netjes terug.

## Fase 4 — Ruimte voor andere formaten

Het tabblad praat met het origineel via één vaste koppeling, zodat EPUB en Word later alleen een eigen
weergave nodig hebben:

```ts
interface OriginalViewer {
  open(container: HTMLElement, original: Blob): Promise<void>;
  showWord(wordIndex: number): void;                   // meelopen + markeren
  showMarks(marks: Mark[]): void;                      // marks tonen
  onWordClick(cb: (wordIndex: number) => void): void;  // terugspringen
  close(): void;
}
// registry: { pdf: PdfViewer }  — later: epub, docx
```

Voor EPUB zijn er geen vaste pagina's; daar wordt "pagina" een hoofdstuk plus positie. Voor Word is het origineel
het best te benaderen als opgemaakte HTML (via de bestaande DOCX-lezer `mammoth`). Beide vallen buiten dit plan.

## Fase 5 — Pdf met marks downloaden (later)

Een knop *Download met marks* maakt een kopie van de pdf waarin elke mark een markering (highlight-annotatie) is,
zodat de marks ook in Acrobat en andere pdf-lezers zichtbaar zijn. Het origineel in speeedy blijft ongewijzigd.
Vraagt een extra bibliotheek om pdf's te bewerken (bijvoorbeeld `pdf-lib`); licentie en omvang eerst nagaan.
Pas bouwen na akkoord van Eddie.

## Instellingen

In het instellingenpaneel, sectie *Origineel*; standaardwaarden in `defaults.ts`. Bestaande profielen krijgen ze
vanzelf (de lezer voegt standaardwaarden samen, `rsvp-reader.ts:169`).

| Sleutel | Standaard | Betekenis |
|---|---|---|
| `originalEnabled` | `true` | tabblad *Origineel* tonen |
| `maxImportBytes` | `524288000` (500 MB) | grootste bestand dat geïmporteerd mag worden (bestaat al sinds fase 0; nu ook in het paneel) |
| `originalStore` | `true` | het originele bestand bewaren bij importeren |
| `originalFollow` | `true` | meelopen naar de huidige pagina |
| `originalHighlight` | `"word"` | `"word"` · `"page"` · `"off"` |
| `originalClickToResume` | `true` | klik op een woord = daar verder lezen |
| `marksEnabled` | `true` | marks zetten met `M` en tonen |
| `marksShowInProgress` | `true` | streepjes per mark in de voortgangsbalk |
| `originalLayout` | `"tabs"` | `"tabs"` (wisselen met `O`) · `"split"` (naast elkaar) |
| `originalSplitSide` | `"right"` | bij gesplitst scherm: origineel rechts of links (op smalle schermen onder) |

## Volgorde en omvang (schatting)

| Fase | Inhoud | Omvang | Stand |
|---|---|---|---|
| 0 | origineel bewaren + paginagrenzen + tests | 1 dag | ✅ PR #1 |
| 1 | tabblad, pdf-weergave, meelopen, woordkoppeling, huidig woord markeren, klikken om verder te lezen | 2,5–3,5 dagen | ✅ PR #2 |
| 2 | marks: zetten, bewaren, tonen in origineel en lezer, lijst | 1,5–2 dagen | volgende (besluit 2026-11-18) |
| 3 | gesplitst scherm | 1–1,5 dag | |
| 4 | vaste koppeling voor andere formaten, opruimen | ½ dag | |
| 5 | pdf met marks downloaden | ½–1 dag | later, na akkoord |

Elke fase is één PR op `zeeneddie/speeedy`, met unit-tests en een browsertest.

## Randvoorwaarden

- **Speeedy zonder dit tabblad blijft werken zoals nu.** Uitzetten (`originalEnabled = false`, `marksEnabled = false`)
  = de lezer van vandaag.
- **Alles blijft in de browser.** Origineel en marks staan alleen in IndexedDB van de gebruiker; niets gaat naar een server.
- **Liever niets dan fout.** Geen koppeling → wel het origineel, geen woordmarkering; een mark waarvan de plek
  niet terug te vinden is, staat in de lijst met alleen de pagina.
- **Oude documenten** werken zoals nu; opnieuw importeren geeft ze een origineel.

## Open punten voor Eddie

Geen. Besluit 2026-11-18: documenten met marks worden niet automatisch opgeruimd.
