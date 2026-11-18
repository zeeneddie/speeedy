# Stand van speeedy (fork zeeneddie/speeedy)

Bijgewerkt 2026-11-18. Startpunt voor wie verder bouwt: wat er is, wat er gepland staat, hoe je test, en de
valkuilen. De plannen zelf staan in `docs/plan-*.md`.

## Wat er gebouwd is

| Wat | Waar | Stand |
|---|---|---|
| Opschoning: geen tracking (Umami), geen Formspree/feedback, geen donatie, geen badges/GitHub-knoppen/ster-verzoek, geen "Free forever"-regel; privacypagina klopt | `index.html`, `src/components/*` | ✅ main (06622e3, 4ec1c12) |
| Origineel fase 0: originele pdf + tekst per pagina bewaren (IndexedDB v3, store `originals`), opslagcontrole, importgrens `maxImportBytes` 500 MB | `storage-service.ts`, `page-map.ts`, `text-parser.ts` | ✅ PR #1 |
| Origineel fase 1: tabblad *Read / Original* (toets `O`), pdf tonen, meelopen, huidig woord markeren, klik = daar verder lezen; pdf.js-fonts lokaal (geen CDN) | `original-pdf-viewer.ts`, `pdf-word-geometry.ts`, `vite.config.ts` | ✅ PR #2 |
| Marks: zin markeren met `M`, lijst, zichtbaar in origineel en lezer; documenten met marks worden nooit automatisch opgeruimd | `marks.ts`, `rsvp-reader.ts` | ✅ PR #3 |
| Voortgang fase 0: gelezen stukken per sessie (sprong = nieuw stuk), dekking/volledig gelezen (99%, gaten ≤ 5 woorden), inhoudsopgave uit pdf-outline, EPUB (nav/NCX), Markdown, Word (.docx); transactionele documentupdates | `reading-progress.ts`, `toc.ts`, `pdf-toc-loader.ts` | ✅ PR #4 |
| Voortgang fase 1: sessies als stukken onder de voortgangsbalk (twee tinten, hover/tik = sessieregel, instelling `progressShowSessions`) en in de bibliotheek (balkje, aantal sessies, *Fully read*, knop *Continue at first unread*) | `session-view.ts`, `rsvp-reader.ts`, `profile-page.ts` | 🟡 PR fase 1 |

**Bewust niet gedaan / backlog uit de reviews van PR #4** (18-11):

| Punt | Waarom (nog) niet |
|---|---|
| Stukken binnen een sessie worden samengevoegd (volgorde en pauzegrenzen niet bewaard) | besluit Eddie 18-11: zo laten |
| Filter-toggle midden in een sessie splitst de sessie (delen kunnen onder de drempel vallen) | bekend randgeval |
| Schrijffout (bv. opslag vol) → sessie weg, geen herhaling | vraagt een wachtrij met retry |
| Racetest van `updateDoc` bewijst de transactie niet (idb-mock) | vraagt `fake-indexeddb` (nieuwe dev-dependency) |
| Pdf-kop niet gevonden → terugval naar paginabegin | de voorgestelde fix brak de e2e op de echte arXiv-pdf; samen oppakken met ruimere titelmatch (koppeltekens: "Long-Context" ↔ "long context") |
| EPUB: twee secties met dezelfde titel in één spine-bestand krijgen dezelfde positie | fragment-id's naar woordpositie vertalen |
| docx: kop in een tabelcel of tekstvak ontbreekt in de inhoudsopgave | alleen alinea's op het hoogste niveau krijgen een merkteken |
| Korte sessies tellen niet mee in de profielstatistiek, wel in de voortgang als ze het einde halen | bewust: per ongeluk lezen hoort niet in de statistiek |
| Bibliotheek rekent sessiestukken in plain woorden, ook met het citatenfilter aan (de lezer rekent gefilterd); breedtes wijken dan iets af | eenvoud; *Continue at first unread* rekent wél om en stapt 12 woorden terug |
| Startpagina (RECENT) heeft nog het oude voortgangsbalkje | buiten fase 1; mee met voortgang fase 2 |
| Seekbalk gebruikt `oklch(var(--b2))` (daisyUI v4-variabele, bestaat niet in v5) → geen achtergrond | bestaand, upstream |

## Wachtrij (plannen)

| # | Plan | Bestand | Open punten |
|---|---|---|---|
| 1 | Marks: `M` = markeren (nooit weghalen), `U` = mark van de huidige zin weghalen — nu wist een tweede `M` in dezelfde zin de mark | `plan-origineel-tabblad.md` §Fase 2 | geen (besluit Eddie 18-11) |
| 2 | Origineel fase 3: gesplitst scherm, meelezen in het origineel tijdens het lezen (pdf) | `plan-origineel-tabblad.md` | geen |
| 3 | Voortgang en inhoud, fase 2–5 (inhoudsopgave links + totaal bovenaan, waar ben ik, context bij pauze, kaders) | `plan-voortgang-en-inhoud.md` | geen |
| 4 | Origineel fase 4–5 (origineel voor docx/EPUB/Markdown, pdf met marks downloaden) | `plan-origineel-tabblad.md` | geen |
| 5 | Afbeeldingen en tabellen (`[foto]`/`[tabel]`, pauze + tonen, toontijd) | `plan-afbeeldingen-en-tabellen.md` | geen |
| 6 | Webpagina's (extensie Chrome+Edge = jetzt-opvolger, url via ophaaldienst, momentopname) | `plan-webpaginas.md` | geen |
| 7 | Samenvatting (Opus via Max 20 / `claude -p`, eigen gecontroleerde bronverwijzingen) en beoordeling (duim + 1–10, per document en hoofdstuk) | `plan-samenvatting-en-beoordeling.md` | anonimiseren ja/nee |
| — | Infra: speeedy in Docker op de **P620** (Dockerfile, compose, poort, Traefik + certificaat) — voorwaarde voor url-ophalen en samenvatting | — | nog niet ingepland |

`plan-leesinformatie.md` is vervangen door `plan-voortgang-en-inhoud.md` (blijft staan als achtergrond).

## Testen

```bash
pnpm install
pnpm exec tsc --noEmit        # typecheck
pnpm lint                     # 11 waarschuwingen is de bestaande stand
pnpm test                     # unit (vitest, jsdom)
pnpm build
pnpm exec playwright test     # browsertests; start zelf een dev-server op :5173
```

**Uitgangsstand browsersuite:** 13 tests falen al op de oorspronkelijke code (app-page, benchmark, keyboard,
reader, landing "ORP alignment", a11y op `#/learn`). Een wijziging is goed als die 13 gelijk blijven en de rest
groen is. Oorzaak van een deel ervan: het welkomstvenster ("Welcome to Speeedy") staat in een nieuwe browser vóór
het scherm en vangt klikken af — nieuwe tests klikken eerst op *Skip*.

**Testmateriaal:** `test-fixtures/boxes/` (kaders: rand, achtergrond, controle zonder kaders),
`test-fixtures/outline/` (pdf met inhoudsopgave, 57 items), `test-fixtures/docx/` (Word met en zonder kopstijlen),
plus de oorspronkelijke boek-pdf en `sample.epub`. Licenties en naamsvermelding in de README's ernaast.

## Valkuilen

- **mammoth in tests:** de app gebruikt de browserversie (leest een ArrayBuffer); `vitest.config.ts` wijst
  `mammoth` daarom naar `mammoth.browser.js`. Zonder die alias: "Could not find file in options".
- **pdf.js in unit-tests** werkt niet (DOMMatrix, worker); pdf-gedrag testen in de browsertests.
- **Documentupdates altijd via `updateDoc`** (één transactie). Twee losse lees-en-schrijfacties tegelijk
  (voortgang + sessie/marks) overschreven elkaar vóór PR #4.
- **Woordnummers hangen af van het citatenfilter.** Marks bewaren hun zin (`quote`) om terug te vinden; sessies
  bewaren stukken in "plain" nummers en rekenen om met `buildWordMap`.
- **Formatter:** `biome check --write` alleen op de eigen bestanden draaien, niet op `e2e/` als geheel (dat
  herformatteert bestaande tests — gebeurd in PR #1, bewust laten staan).
- **Totaal aantal woorden voor voortgang** = `tokenize(text).length` (plain), niet `countWords`/`wordCount`. De
  voortgangsbalk in de lezer rekent in de gefilterde reeks: geef `sessionPieces` dan de woordkoppeling mee.
- **GitHub Actions draait niet in deze fork** (0 runs ooit, ook na vrijgave, `allow all` en workflow uit/aan;
  andere repo's van het account draaien wel). Oorzaak onbekend. Tot dat opgelost is: lokaal meten zoals hierboven
  en mergen met `mq-merge` + `MQ_ALLOW_NO_CHECKS=1`, met de getallen in de PR.
- **Fork tegenover upstream:** `main` wijkt flink af van `sami-29/speeedy`; upstream binnenhalen = mergen met
  conflicten in landing/app-page.
