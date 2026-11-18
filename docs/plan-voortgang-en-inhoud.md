# Plan — voortgang en inhoud

Opgesteld 2026-11-18 op verzoek van Eddie. Vervangt [plan-leesinformatie.md](plan-leesinformatie.md) en voegt de
wens *sessies en inhoudsopgave* toe (besluit 2026-11-18: samenvoegen, één fundament voor kopjes en pagina's).
Basis: speeedy op `main` na PR #3 (tabblad Origineel en marks).

## Wat het wordt

**Je ziet per document wat je gelezen hebt, in welke sessies, en waar je bent in de opbouw van het document.**

1. **Sessies.** Elke leessessie is een stuk op de voortgangsbalk: waar ze begon en waar ze stopte. Een volgende
   sessie begint waar de vorige stopte. Hover (op een telefoon: tik) toont datum, begin, einde, duur en snelheid.
   Zichtbaar in de lezer **én** in de bibliotheek.
2. **Volledig gelezen.** Een document is volledig gelezen als alle gelezen stukken samen het hele document dekken,
   op kleine gaten na. Overgeslagen stukken blijven zichtbaar.
3. **Inhoudsopgave links** in de lezer: de kopjes van het document, per kopje hoever je bent (het deel dat je echt
   gelezen hebt), klik = daarheen. Pdf zonder ingebouwde inhoudsopgave: een lijst van pagina's in plaats van
   geraden kopjes.
4. **Totale voortgang bovenaan** de pagina.
5. **Uit het plan leesinformatie:** waar ben ik (hoofdstuk, pagina), resterende tijd voor hoofdstuk en boek,
   sessiecijfers tijdens het lezen, context bij pauze, en kaders als intermezzo.

Besluiten Eddie 2026-11-18: docx (Word) in fase 0, .doc niet · "volledig gelezen" bij 99% dekking met gaten tot 5
woorden · sessies in lezer én bibliotheek · "volledig gelezen" = gelezen stukken dekken alles ·
pdf zonder inhoudsopgave → pagina's als lijst · eerst marks (✅ PR #3), dan dit plan · plannen samengevoegd.
Eerder (leesinformatie): standaard alleen tonen bij pauze · sessiecijfers standaard uit · pauzes alleen via
Pomodoro · DOCX/HTML/ODT-koppen later · instellingen per boek later.

## Hoe speeedy het nu doet

| Onderdeel | Stand | Waar |
|---|---|---|
| Sessies | per sessie datum, titel, woorden, snelheid, duur, percentage; **geen document-id en geen begin/eind** | `ReadingSession` in `types.ts`; `recordSession` in `stats-service.ts`; opgeslagen in het profiel (max. 500) |
| Begin en eind van een sessie | bestaan in de lezer (`wordsAtSessionStart`, `state.wordIndex` bij opslaan), maar worden niet bewaard | `rsvp-reader.ts`, `saveSession` |
| Plek per document | alleen de laatste plek (`resumeWordIndex`) en een percentage | `SavedDocument` |
| Pagina's | tekst per pagina voor pdf's, en bij welk woord elke pagina begint | `pages` in `SavedDocument`; `page-map.ts` |
| Kopjes | niet uit het document gehaald | — |
| Bibliotheek | lijst met een percentage per document | `profile-page.ts` (tab *Library*) |
| Marks | per document, met pagina en zin | `marks` in `SavedDocument`; `marks.ts` |

**Waar het om draait:** "hoever ben je" wordt nu gemeten aan je plek. Maar je kunt springen (pijltjes, voortgangsbalk,
klik in het origineel, de marks-lijst). Spring je van pagina 3 naar 200, dan zegt "je plek" 70% terwijl je bijna
niets gelezen hebt. Dit plan meet daarom **gelezen stukken**.

---

## Fase 0 — Fundament: gelezen stukken, sessies en inhoudsopgave

### Gelezen stukken

Een sessie bestaat uit een of meer **stukken** (doorlopend gelezen reeksen woorden). Een stuk begint bij *play* en
eindigt bij *pauze* of bij een **sprong**: elke `seekToWord` / `seekBy` tijdens het lezen sluit het stuk af en
begint een nieuw. Zo telt overgeslagen tekst niet als gelezen.

```ts
interface ReadSpan {            // woorden [start, end] inclusief, in "plain" woordnummers
  start: number;
  end: number;
}
interface DocSession {          // in SavedDocument.sessions
  id: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;           // actieve leestijd (zonder pauzes)
  wordsRead: number;
  wpm: number;
  spans: ReadSpan[];
}
```

- **Opslag:** `SavedDocument.sessions` (bij het document, zoals de marks). Het profiel houdt zijn eigen
  `ReadingSession` voor de statistiek, voortaan **met `docId`** zodat beide te koppelen zijn. Oude sessies in het
  profiel hebben geen `docId` en geen stukken; die blijven alleen in de statistiek.
- **Korte sessies:** een sessie van minder dan 5 seconden of minder dan 10 woorden wordt niet bewaard (per ongeluk op
  spatie gedrukt).
- **Woordnummers in "plain".** Met het citatenfilter aan telt de lezer minder woorden. Stukken worden daarom altijd
  bewaard in de woordnummers **zonder** filter. Een kleine koppeltabel (filter-woord → plain-woord, één keer per
  document berekend door de twee woordreeksen op volgorde naast elkaar te leggen, zoals bij de woordkoppeling van
  het tabblad *Origineel*) vertaalt heen en terug. Zo blijven sessies kloppen als je het filter omzet.

### Volledig gelezen

`coverage(document) = vereniging van alle stukken van alle sessies`. Volledig gelezen als, na het dichten van gaten
van **hooguit 5 woorden**, de stukken samen **minstens 99%** van de woorden dekken. Beide grenzen zijn constanten in
één bestand, makkelijk bij te stellen. Overgeslagen stukken (gaten groter dan 5 woorden) worden getoond.

### Inhoudsopgave

```ts
interface TocEntry {            // in SavedDocument.toc
  title: string;
  level: number;                // 1 = hoofdstuk, 2 = paragraaf, …
  startWord: number;            // plain woordnummer
  page: number | null;
}
```

| Bron | Hoe | Precisie |
|---|---|---|
| Pdf met ingebouwde inhoudsopgave | `pdf.getOutline()` + bestemming → paginanummer; daarna de titel opzoeken in de woorden van die pagina voor het exacte beginwoord, anders het begin van de pagina | pagina zeker, woord meestal |
| Pdf zonder inhoudsopgave | **geen kopjes**; de zijbalk toont pagina's in groepen (p. 1–10, 11–20, …) | zeker |
| EPUB | `nav.xhtml` (EPUB 3) of `toc.ncx` (EPUB 2) → spine-bestand; de parser houdt per spine-bestand bij bij welk woord het begint | zeker per bestand |
| Markdown | regels die met `#` beginnen | zeker |
| Word (.docx) | `mammoth.convertToHtml` in plaats van `extractRawText`; koppen met de stijlen *Kop 1*, *Kop 2*, … worden `h1`, `h2`, …; zelfde omzetting als het plan *afbeeldingen en tabellen* nodig heeft (één keer bouwen) | zeker voor koppen met kopstijl; zonder kopstijl geen inhoudsopgave |
| Word (.doc, oud formaat) | niet mogelijk: de bibliotheek leest het formaat niet; speeedy haalt er alleen losse tekst uit (`parseDocLegacy`) en adviseert opslaan als .docx | — |
| HTML, ODT | later | — |

**Bestaande pdf's met een bewaard origineel** krijgen hun inhoudsopgave zonder opnieuw importeren: de outline wordt
bij het eerste openen uit het origineel gelezen en bewaard. Andere bestaande documenten: opnieuw importeren.

**Tests:** stukken worden gesplitst bij een sprong; korte sessies niet bewaard; koppeltabel plain ↔ filter klopt
op de test-pdf; dekking en "volledig gelezen" met gaten van 5 en 6 woorden; outline van een pdf (fixture met
inhoudsopgave: `test-fixtures/outline/`); EPUB-inhoudsopgave uit `test-fixtures/sample.epub`; Markdown-kopjes;
docx met kopstijlen (kleine fixture maken) en docx zonder kopstijlen (geen inhoudsopgave); bestaande docx-tekst
blijft gelijk na de omschakeling naar `convertToHtml`.

## Fase 1 — Sessies zichtbaar

**In de lezer.** De voortgangsbalk bovenaan krijgt een tweede laag: per sessie de gelezen stukken als gekleurde
vakjes (afwisselend twee tinten, zodat opeenvolgende sessies te onderscheiden zijn); overgeslagen stukken blijven
leeg. De huidige plek blijft de bestaande lijn. Hover over een stuk (tik op een telefoon) toont:

> Sessie 3 · 18 nov 2026, 14:05 · p. 41 → p. 57 · 22 min · 310 wpm

**In de bibliotheek** (tab *Library*): per document een dun balkje met dezelfde stukken, een label *Volledig
gelezen* waar dat geldt, en het aantal sessies. Hover/tik werkt hier ook.

**Verder lezen** blijft zoals nu (de laatste plek); daarnaast in de lijst een knop *Verder bij het eerste
ongelezen stuk*.

**Tests:** na twee sessies twee groepen vakjes op de juiste plek; hover toont de juiste gegevens; label *Volledig
gelezen* verschijnt pas boven de grens; bibliotheekbalkje gelijk aan de lezer.

## Fase 2 — Inhoudsopgave links en totale voortgang bovenaan

**Zijbalk links** in de lezer, in- en uitklapbaar (onthouden), verborgen in focusmodus; het instellingenpaneel blijft
rechts.
- Per kopje: titel (ingesprongen naar niveau), een balkje met het **gelezen** deel van dat stuk, en het aantal marks.
- Het kopje waar je nu bent is gemarkeerd; de zijbalk scrolt mee.
- Klik op een kopje = pauzeren en naar het begin ervan springen (dat sluit het lopende stuk af, fase 0).
- Pdf zonder inhoudsopgave: pagina's in groepen van 10 (instelbaar), met hetzelfde balkje.
- Documenten zonder pagina's of kopjes (geplakte tekst, TXT): geen zijbalk, alleen de totale voortgang.

**Bovenaan de pagina:** één regel met de totale voortgang:

> 62% gelezen · 3 sessies · hoofdstuk 4 · p. 87/312 · nog 2 u 10 min

**Tests:** zijbalk toont de kopjes van de EPUB-fixture in volgorde; balkje per kopje gelijk aan de dekking;
klik springt naar het juiste woord; pagina-groepen bij een pdf zonder inhoudsopgave.

## Fase 3 — Leesinformatie tijdens het lezen (uit plan leesinformatie, onderdelen 1, 2, 5)

- **Waar ben ik:** hoofdstuk en pagina (komt uit de inhoudsopgave en `page-map`).
- **Resterende tijd** voor het hoofdstuk en het boek, met de bestaande berekening (`getEstimatedRemainingMs`,
  uitgebreid met een eindwoord); de huidige "… left" gaat daarin op, zodat het niet dubbel op het scherm staat.
- **Sessiecijfers** tijdens het lezen: actieve leestijd, woorden en werkelijke snelheid van deze sessie
  (dezelfde berekening als bij het opslaan; één hulpfunctie).
- Standaard **alleen bij pauze** zichtbaar; hoofdschakelaar met sneltoets `I`.

## Fase 4 — Context bij pauze (uit plan leesinformatie, onderdeel 4)

- In plaats van vast ±40 woorden: de hele **zin**, **alinea** of **pagina** rond het huidige woord.
- De **kop** van het huidige stuk erboven.
- Knoppen en sneltoetsen: *één zin terug*, *één alinea terug*.
- Marks blijven zichtbaar (gemarkeerde zinnen gekleurd).

## Fase 5 — Kaders als intermezzo (uit plan leesinformatie, onderdeel 6)

Ongewijzigd uit plan leesinformatie: kaders in pdf's herkennen, verplaatsen naar het eind van de alinea of het
(sub)hoofdstuk, aankondigen als intermezzo, en kunnen overslaan.
- **Eerst de proef** (½ dag) op `test-fixtures/boxes/`: kader met rand, kader met achtergrond, en twee kolommen
  zonder kaders als controle. Pas bouwen als er **nul** ten onrechte herkende kaders zijn.
- Een overgeslagen intermezzo telt niet als gelezen, maar ook niet als gat bij "volledig gelezen".

## Instellingen

| Sleutel | Standaard | Betekenis |
|---|---|---|
| `progressShowSessions` | `true` | sessies als stukken op de voortgangsbalk |
| `tocEnabled` | `true` | inhoudsopgave links tonen |
| `tocPageGroup` | `10` | pagina's per groep bij een pdf zonder inhoudsopgave |
| `infoEnabled` | `true` | hoofdschakelaar leesinformatie (`I`) |
| `infoVisibility` | `"paused"` | `"paused"` · `"always"` |
| `infoTimeLeft` | `"both"` | `"off"` · `"chapter"` · `"book"` · `"both"` |
| `infoSession` | `false` | sessiecijfers tijdens het lezen |
| `infoPauseContext` | `"paragraph"` | `"sentence"` · `"paragraph"` · `"page"` |
| `intermezzoPlacement` | `"section"` | `"inline"` · `"paragraph"` · `"section"` |
| `intermezzoMode` | `"ask"` | `"read"` · `"ask"` · `"skip"` |

## Volgorde en omvang (schatting)

| Fase | Inhoud | Omvang |
|---|---|---|
| 0 | gelezen stukken, sessies per document, koppeltabel filter, inhoudsopgave (pdf-outline, EPUB, Markdown, docx) | 2,5–3 dagen |
| 1 | sessies op de voortgangsbalk en in de bibliotheek, volledig gelezen | 1–1,5 dag |
| 2 | inhoudsopgave-zijbalk, voortgang per kopje, totale voortgang bovenaan | 1,5–2 dagen |
| 3 | waar ben ik, resterende tijd, sessiecijfers | 1 dag |
| 4 | context bij pauze | 1 dag |
| 5 | kaders: proef ½ dag, daarna bouwen | ½ + 2 dagen |

Elke fase is één PR op `zeeneddie/speeedy`, met unit-tests en een browsertest.

## Randvoorwaarden

- **Alles uit = de lezer van nu.** De bestaande tests blijven groen.
- **Alles blijft in de browser.** Sessies, inhoudsopgave en marks staan alleen in IndexedDB.
- **Liever niets dan fout.** Geen geraden kopjes; een stuk wordt alleen als gelezen geteld als het echt is
  afgespeeld.
- **Oude gegevens blijven werken.** Oude sessies blijven in de statistiek; oude documenten tonen hun laatste plek
  zoals nu tot er nieuwe sessies zijn.

## Open punten voor Eddie

Geen. Besluiten 2026-11-18: test-pdf met inhoudsopgave toegevoegd (`test-fixtures/outline/`); docx in fase 0;
"volledig gelezen" bij 99% dekking met gaten tot 5 woorden.
