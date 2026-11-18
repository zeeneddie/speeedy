# Plan — afbeeldingen tonen tijdens het snellezen

Opgesteld 2026-11-18 op verzoek van Eddie. **Status: in de wachtrij** — na de marks (fase 2 van
`plan-origineel-tabblad.md`) en het plan *voortgang en inhoud* (sessies en inhoudsopgave).

Besluiten Eddie 2026-11-18: pdf zit in dezelfde ronde als EPUB, Word en HTML (fase 3 hoort bij de eerste ronde) ·
bij "uit" verschijnt **[foto]**.

## Wat het wordt

Een schakelaar **Foto's tonen**:

- **Uit** — op de plek van een afbeelding verschijnt alleen **[foto]**, als woord in het snellezen. Je weet dat er een afbeelding stond, zonder te stoppen.
- **Aan, fase 1** — bij een afbeelding pauzeert het lezen en wordt de afbeelding getoond; met spatie start je
  zelf weer.
- **Aan, fase 2** — instelbaar hoeveel seconden de afbeelding blijft staan; daarna gaat het lezen vanzelf verder.
  Zolang de afbeelding in beeld is, loopt de tekst niet door.

## Hoe speeedy het nu doet

Afbeeldingen gaan bij het inlezen volledig verloren; er verschijnt ook geen woord "foto".

| Formaat | Nu | Waar |
|---|---|---|
| Word (DOCX/DOC) | alleen platte tekst (`mammoth.extractRawText`) | `text-parser.ts:198`, `:211` |
| EPUB, HTML | `<img>` wordt overgeslagen | `htmlToPlainText` in `text-utils.ts:43` |
| PDF | alleen tekst; plaatjes zijn getekende vlakken | `text-parser.ts` (`parsePdf`) |

## Fase 0 — Afbeeldingen bewaren bij het inlezen (EPUB, Word, HTML)

- **Markering in de tekst.** Op de plek van een afbeelding komt een vaste markering als eigen alinea, bijvoorbeeld
  `⟦img:3⟧` (nummer = volgorde in het document). De lezer herkent die markering; de rest van speeedy ziet haar als
  één woord.
- **EPUB / HTML:** `htmlToPlainText` schrijft bij `<img>` de markering; het plaatje komt uit het EPUB-archief
  (JSZip, zit er al in) of als `data:`-adres uit de HTML. Beschrijving: `alt`, of het bijschrift (`<figcaption>`).
- **Word:** `mammoth.convertToHtml` in plaats van `extractRawText` levert plaatjes als `data:`-adres met hun plek;
  daarna dezelfde route als HTML. Na te gaan: of de tekst dan gelijk blijft aan nu (anders verschuiven bestaande
  documenten — die worden niet opnieuw ingelezen, dus geen risico voor wat er al staat).
- **Kleine plaatjes overslaan:** kleiner dan 100 × 100 pixels (logo's, lijntjes, iconen) krijgen geen markering.
- **Opslag:** een store `images` in IndexedDB (sleutel document-id + nummer, waarde het plaatje als `Blob` plus
  beschrijving). Opgeruimd met het document, net als `originals`. Opslagcontrole vooraf; past het niet, dan
  tekst zonder afbeeldingen, met melding.
- **Bestaande documenten** hebben geen afbeeldingen; opnieuw importeren geeft ze die.

## Fase 1 — Schakelaar en pauze met afbeelding

- **Instelling** `showImages`: uit (standaard) of aan.
- **Uit:** de markering wordt als **[foto]** getoond, met de gewone woordtijd.
- **Aan:** de engine pauzeert op de markering; de lezer toont de afbeelding schermvullend met de beschrijving
  eronder. Spatie = verder lezen.
- **Telt niet mee:** de markering telt niet als gelezen woord voor snelheid, statistiek en resterende tijd. Voor
  de pagina-indeling van het tabblad *Origineel* (`page-map.ts`) gaat ze er vóór het tellen uit.
- **Zichtbaar bij pauze:** in de weergave *volledige tekst* een klein plaatje of icoon op de plek.

## Fase 2 — Instelbare toontijd

- **Instelling** `imageSeconds`: 1–10 seconden, standaard 3. Na die tijd gaat het lezen vanzelf verder; de tekst
  loopt niet door zolang de afbeelding in beeld is.
- Spatie slaat de wachttijd over; een tweede keer spatie pauzeert zoals altijd.
- `imageSeconds = 0` betekent: wachten op spatie (gedrag van fase 1).

## Fase 3 — Pdf (in dezelfde ronde, besluit 2026-11-18)

Een pdf kent geen "afbeelding na woord X". Aanpak: met pdf.js de plekken van getekende plaatjes per pagina
bepalen, het plaatje uitsnijden uit de getekende pagina (techniek van het tabblad *Origineel*) en de markering
plaatsen tussen de woorden die erboven en eronder staan. **Alleen tonen als de plek zeker is**; anders geen
markering. Bouwt op de pdf-weergave van het tabblad *Origineel* (gemerged, PR #2).

## Instellingen

| Sleutel | Standaard | Betekenis |
|---|---|---|
| `showImages` | `false` | afbeeldingen tonen (aan) of alleen het woord (uit) |
| `imageSeconds` | `3` | toontijd in seconden; `0` = wachten op spatie |
| `imageMinPixels` | `100` | kleinere plaatjes overslaan (breedte én hoogte) |

## Tests

- EPUB en Word met een plaatje: markering op de juiste plek, plaatje en beschrijving bewaard; klein plaatje overgeslagen.
- Uit: het woord verschijnt; aan: de lezer pauzeert en toont het plaatje; spatie gaat verder.
- Fase 2: na de ingestelde tijd gaat het lezen verder; tijdens het tonen schuift de tekst niet op.
- Statistiek en resterende tijd tellen de markering niet mee; de pagina-indeling van *Origineel* blijft kloppen.

## Open punten voor Eddie

Geen. Besluiten 2026-11-18: pdf meteen meenemen; bij "uit" **[foto]**.
