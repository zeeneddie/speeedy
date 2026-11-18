# Plan — tabblad "Origineel" naast het snellezen

Opgesteld 2026-11-18 op verzoek van Eddie. Basis: speeedy zoals het nu is (`zeeneddie/speeedy`, commit `4ec1c12`).

## Wat het wordt

In de lezer komen twee tabbladen voor **hetzelfde document**:

- **Snellezen** — het bestaande scherm, woord voor woord.
- **Origineel** — het document zoals het er echt uitziet (pdf met eigen opmaak, kaders, plaatjes).

Het origineel **loopt mee**: het staat op de pagina die je aan het lezen bent, met het huidige woord gemarkeerd.
**Klik je op een woord** in het origineel, dan gaat het snellezen vanaf dat woord verder. Eerst alleen voor pdf;
de opzet laat ruimte voor EPUB en Word later.

Besluiten Eddie 2026-11-18: tab binnen speeedy · meelopen · terugspringen door te klikken · eerst pdf, ruimte
voor uitbreiding · overschakelen pauzeert het lezen · zowel tabbladen als een gesplitst scherm moeten mogelijk zijn ·
geen vaste grens van 50 MB meer, wel een controle op opslagruimte en een instelbare bovengrens (standaard 500 MB).

## Hoe speeedy het nu doet

| Onderdeel | Stand | Waar |
|---|---|---|
| Pdf inlezen | alleen de tekst wordt eruit gehaald; pagina's worden samengevoegd | `text-parser.ts:130` (`parsePdf`, regel 181) |
| Het bestand zelf | wordt **niet** bewaard; na het inlezen is het weg | `file-uploader.ts:73` geeft alleen de tekst door |
| Bibliotheek | IndexedDB `speeedy-db`, store `documents`, max. 20 documenten, alleen tekst | `storage-service.ts` |
| Bestandsgrootte | max. 50 MB per upload | `file-uploader.ts:36` |
| Springen naar een woord | bestaat al: `engine.seekToWord(index)` | `rsvp-engine.ts:290` |
| Volledige tekst bij pauze | toont de uitgelezen tekst, zonder opmaak; klik op een woord springt erheen | `rsvp-reader.ts:857` |
| Pdf tonen | pdf.js (`pdfjs-dist` 5.5) zit er al in, inclusief de viewer-onderdelen (`pdfjs-dist/web`) en de lettertype- en tekentabellen (`cmaps`, `standard_fonts`) | `package.json` |

Er zijn dus drie dingen nodig:
1. het originele bestand bewaren;
2. weten op welke plek in de pdf elk woord staat;
3. het origineel tonen en koppelen aan de lezer.

---

## Fase 0 — Origineel bewaren en paginagrenzen vastleggen

**Bestand bewaren.** Een nieuwe store `originals` in IndexedDB, sleutel = document-id, waarde = het bestand als
`Blob` (IndexedDB slaat dat rechtstreeks op). `DB_VERSION` gaat van 2 naar 3; de upgrade maakt alleen de nieuwe
store aan, bestaande documenten blijven ongemoeid.

- Bij verwijderen van een document (`deleteSavedDocument`) en bij opruimen boven de 20 (`pruneDocuments`) gaat
  het origineel mee.
- Opslag: vragen om blijvende opslag (`navigator.storage.persist()`) en vooraf controleren of er ruimte is
  (`navigator.storage.estimate()`). Past het niet, dan wordt het document zonder origineel bewaard, met een melding.
- **Bestandsgrootte** (besluit Eddie 2026-11-18): de vaste grens van 50 MB in `file-uploader.ts:36` vervalt. In
  de plaats komt de instelling `maxImportBytes`, standaard 500 MB, als bescherming tegen vastlopen van de browser
  (het bestand staat bij het inlezen in zijn geheel in het werkgeheugen). Boven de grens: een melding met de
  grootte en de ingestelde grens, zoals nu. Op telefoons kan het geheugen eerder op zijn dan de grens; dan volgt
  een nette foutmelding in plaats van een vastgelopen tab.
- Ontdubbelen blijft op de tekst (`contentHash`), zoals nu.

**Paginagrenzen.** `parsePdf` doorloopt de pagina's al één voor één. In plaats van alles samen te voegen,
houdt het per pagina de tekst apart bij. Bij het laden in de lezer wordt per pagina opgedeeld in woorden
(dezelfde `tokenize`, na dezelfde bewerkingen zoals `removeCitations`), zodat vaststaat **bij welk woord elke
pagina begint**. Dit is hetzelfde fundament als fase 0 van
[plan-leesinformatie.md](plan-leesinformatie.md) — één keer bouwen, beide plannen gebruiken het.

Controle: de som van de woorden per pagina moet gelijk zijn aan het totaal; klopt dat niet, dan valt het
meelopen terug op "geen koppeling" (het origineel is dan wel te zien, maar loopt niet mee).

**Datamodel** (uitbreidbaar voor andere formaten):

```ts
interface OriginalRef {
  kind: "pdf";              // later: "epub" | "docx"
  storeKey: string;         // sleutel in de store "originals"
  mime: string;
  bytes: number;
}
// SavedDocument krijgt: original?: OriginalRef; pages?: string[] (tekst per pagina)
```

**Oude documenten** hebben geen origineel. Het tabblad staat dan uitgegrijsd met de uitleg "Importeer het
bestand opnieuw om het origineel te zien".

**Tests**: bestand boven `maxImportBytes` geeft de melding, eronder niet; te weinig opslagruimte → tekst bewaard,
origineel niet, met melding; bestand wordt bewaard en weer opgehaald; verwijderen ruimt het origineel op; de som van de woorden
per pagina klopt voor de test-pdf in `test-fixtures/`, met en zonder `removeCitations`; database-upgrade van
versie 2 naar 3 houdt bestaande documenten intact.

## Fase 1 — Tabblad met de pdf, meelopen per pagina

**Tabbladen.** Bovenaan de lezer twee tabs: *Snellezen* · *Origineel*. Sneltoets `O` om te wisselen (nu vrij;
in gebruik zijn spatie, pijltjes, `R`, `F`, `?`, Escape). Overschakelen naar *Origineel* **pauzeert** het lezen;
terug naar *Snellezen* gaat verder waar je was (of waar je in het origineel op klikte, fase 2).

**Weergave.** Pdf-pagina's tekenen met pdf.js (`PDFPageProxy.render` op een canvas) plus de tekstlaag
(`TextLayer` uit `pdfjs-dist`), zodat tekst te selecteren en aan te klikken is. Alleen de pagina's in beeld
worden getekend (en één ervoor en erna), zodat grote boeken snel blijven. Zoomen: passend op breedte, plus en min.

**Meelopen.** Bij het openen van het tabblad springt de weergave naar de pagina van het huidige woord (uit de
paginatabel van fase 0) en kleurt die pagina licht. Bladeren kan vrij; een knop *Terug naar mijn plek* brengt je
weer naar de huidige pagina.

**Geen gegevens naar buiten.** pdf.js kan voor sommige pdf's tekentabellen en standaardlettertypen ophalen.
Die worden mee gebouwd uit `node_modules/pdfjs-dist/cmaps` en `standard_fonts` en lokaal geserveerd
(`cMapUrl` en `standardFontDataUrl` naar de eigen build). Geen CDN.

**Laden op afroep.** De weergavecode wordt pas geladen als iemand het tabblad opent (dynamische `import`), zodat
de lezer zelf niet trager wordt.

**Tests**: tabblad opent op de juiste pagina voor een woord midden in de test-pdf; wisselen pauzeert; in de
build zitten geen verwijzingen naar externe adressen.

## Fase 2 — Huidig woord markeren en klikken om verder te lezen

**Van woord naar plek.** Per pagina de woorden uit de lezer naast de tekststukken van de pdf leggen (pdf.js
levert per stuk de tekst en de positie). Beide reeksen worden genormaliseerd (kleine letters, leestekens en
afbreekstreepjes weg) en op volgorde gekoppeld. Woorden die de lezer niet heeft (bijvoorbeeld weggefilterde
citaties) worden overgeslagen. Resultaat: per woord een plek op de pagina.

**Markeren.** Het huidige woord krijgt een gekleurd vlak op die plek in de tekstlaag. Lukt de koppeling voor
een woord niet, dan wordt alleen de pagina gemarkeerd — **liever niets dan een verkeerd woord**.

**Klikken om verder te lezen.** Klik op een woord in het origineel → het dichtstbijzijnde gekoppelde woord →
`engine.seekToWord(index)` → terug naar *Snellezen*, met de bestaande aftelling (`countdownEnabled`) als die aan
staat. De voortgang wordt opgeslagen zoals nu (`persistProgress`).

**Tests**: koppeling op de test-pdf (aantal gekoppelde woorden, nul verkeerde op een steekproef); klik op een
woord landt op hetzelfde woord in de lezer; woorden zonder koppeling geven alleen de paginamarkering.

## Fase 3 — Gesplitst scherm

Naast de tabbladen een tweede weergave: snellezen en origineel **naast elkaar** (`originalLayout = "split"`).

- Het origineel loopt dan **tijdens het lezen** mee: de pagina en het gemarkeerde woord volgen de lezer. Om het
  oog niet af te leiden, schuift de weergave per alinea of per pagina op, niet per woord (instelling, standaard
  per alinea).
- Klikken op een woord in het origineel pauzeert, springt naar dat woord en gaat verder na de aftelling.
- Verdeling instelbaar met een sleepbare scheidslijn; op smalle schermen (telefoon) staat het origineel onder
  het woord, of valt de weergave terug op tabbladen.
- Wisselen tussen tabbladen en gesplitst scherm met een knop in de lezer; `O` blijft in beide het origineel
  tonen of verbergen.
- Prestaties: meelopen tijdens het lezen mag het tempo van de lezer niet storen. Het origineel wordt bijgewerkt
  buiten de woordtimer om (`requestAnimationFrame`), en alleen als de pagina of alinea verandert.

**Tests**: bij gesplitst scherm loopt het origineel mee zonder dat de woordtiming verschuift (gemeten tegen de
lezer zonder origineel); klik in het origineel landt op het juiste woord; op een smal scherm valt de weergave
netjes terug.

## Fase 4 — Ruimte voor andere formaten

Het tabblad praat met het origineel via één vaste koppeling, zodat EPUB en Word later alleen een eigen
weergave nodig hebben:

```ts
interface OriginalViewer {
  open(container: HTMLElement, original: Blob): Promise<void>;
  showWord(wordIndex: number): void;            // meelopen + markeren
  onWordClick(cb: (wordIndex: number) => void): void;  // terugspringen
  close(): void;
}
// registry: { pdf: PdfViewer }  — later: epub, docx
```

Voor EPUB zijn er geen vaste pagina's (de tekst loopt mee met de schermgrootte); daar wordt "pagina" een
hoofdstuk plus positie. Voor Word is het origineel het best te benaderen als opgemaakte HTML (via de bestaande
DOCX-lezer `mammoth`). Beide vallen buiten dit plan.

## Instellingen

In het instellingenpaneel, sectie *Origineel*; standaardwaarden in `defaults.ts`. Bestaande profielen krijgen ze
vanzelf (de lezer voegt standaardwaarden samen, `rsvp-reader.ts:169`).

| Sleutel | Standaard | Betekenis |
|---|---|---|
| `originalEnabled` | `true` | tabblad *Origineel* tonen |
| `maxImportBytes` | `524288000` (500 MB) | grootste bestand dat geïmporteerd mag worden; vervangt de vaste 50 MB |
| `originalStore` | `true` | het originele bestand bewaren bij importeren |
| `originalFollow` | `true` | meelopen naar de huidige pagina |
| `originalHighlight` | `"word"` | `"word"` · `"page"` · `"off"` |
| `originalClickToResume` | `true` | klik op een woord = daar verder lezen |
| `originalLayout` | `"tabs"` | `"tabs"` (wisselen met `O`) · `"split"` (naast elkaar) |
| `originalSplitSide` | `"right"` | bij gesplitst scherm: origineel rechts of links (op smalle schermen onder) |

## Volgorde en omvang (schatting)

| Fase | Inhoud | Omvang |
|---|---|---|
| 0 | origineel bewaren + paginagrenzen + tests | 1 dag |
| 1 | tabblad, pdf-weergave, meelopen per pagina, lokaal geserveerde pdf.js-bestanden | 1–1,5 dag |
| 2 | woordkoppeling, markeren, klikken om verder te lezen | 1,5–2 dagen |
| 3 | gesplitst scherm | 1–1,5 dag |
| 4 | vaste koppeling voor andere formaten, opruimen | ½ dag |

Elke fase is één PR op `zeeneddie/speeedy`, met unit-tests en een browsertest. Fase 0 is gedeeld met
`plan-leesinformatie.md`; wie eerst gebouwd wordt, legt het fundament.

## Randvoorwaarden

- **Speeedy zonder dit tabblad blijft werken zoals nu.** Uitzetten (`originalEnabled = false`) = de lezer van vandaag.
- **Alles blijft in de browser.** Het origineel staat alleen in IndexedDB van de gebruiker; niets gaat naar een server.
- **Liever niets dan fout.** Geen koppeling → wel het origineel, geen meelopen of markering.
- **Oude documenten** werken zoals nu; opnieuw importeren geeft ze een origineel.

## Open punten voor Eddie

Geen. Alle vragen zijn beantwoord (besluiten 2026-11-18, zie boven).
