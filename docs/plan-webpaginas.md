# Plan — webpagina's snellezen

Opgesteld 2026-11-18 op verzoek van Eddie. **Status: in de wachtrij**, na *voortgang en inhoud* en *afbeeldingen en
tabellen* (hergebruikt de plaatjes en het tabblad *Origineel*).

## Wat het wordt

Naast bestanden en geplakte tekst kun je een **webpagina** snellezen:

- speeedy leest alleen het **hoofdartikel**; menu's, zijbalken en reclame vallen weg;
- de **plaatjes van het artikel** blijven (volgens het plan *afbeeldingen en tabellen*), reclameplaatjes niet;
- het tabblad **Origineel** toont een **momentopname** van het artikel zoals het op de pagina stond — tekst met
  eigen opmaak, koppen en plaatjes — met de plek waar je bent en je marks.

Besluiten Eddie 2026-11-18:
1. Een kleine eigen ophaaldienst naast speeedy mag (speeedy komt daarvoor op de server).
2. Het tabblad toont een **momentopname**, niet de live pagina.
3. Pagina's achter een inlog (kranten, vakbladen) moeten **direct** werken → de **browserknop** is de eerste stap.
4. Apart plan, in de wachtrij.

## Twee routes, één resultaat

| Route | Hoe | Werkt voor | Server nodig |
|---|---|---|---|
| **A. Browserknop** (fase 1) | Je staat op de pagina en klikt *Lees met speeedy*. De knop haalt het artikel uit de pagina die je al ziet, dus ook als je bent ingelogd. | alle pagina's die je in je browser kunt zien, ook achter een inlog | nee |
| **B. Url opgeven** (fase 2) | In speeedy een adres plakken; een kleine eigen ophaaldienst haalt de pagina op. | openbare pagina's | ja, naast speeedy |

Beide leveren hetzelfde: **tekst + plaatjes + momentopname**, opgeslagen zoals een geïmporteerd document. Alles daarna
(lezen, tabblad *Origineel*, marks, sessies) is gelijk.

## Hoofdartikel herkennen

- **Mozilla Readability** (Apache-2.0; ook gebruikt voor de leesweergave van Firefox): haalt het hoofdartikel uit de
  pagina en laat menu's, zijbalken, voetteksten en de meeste reclame weg. Levert titel, auteur, datum en het artikel
  als opgeschoonde HTML.
- **Extra filter op plaatjes**, omdat reclame soms midden in een artikel staat. Een plaatje gaat eruit als:
  - het van een bekende advertentiedienst komt (een lijst domeinen, zoals in gangbare adblock-lijsten);
  - het een standaard advertentieformaat heeft (bijvoorbeeld 300×250, 728×90, 160×600);
  - het in een element staat met een advertentiekenmerk (`ad`, `advert`, `sponsor`, `promo` in klasse of id);
  - het kleiner is dan 100×100 pixels (iconen, tellers — de bestaande regel `imageMinPixels`).
  
  **Bij twijfel geen plaatje**, liever dan reclame.
- **Bijschriften** (`figcaption`, `alt`) blijven bij het plaatje.

## Fase 1 — Browserknop (route A)

**Vorm: een browserextensie** (Chrome, Manifest V3). Een bookmarklet is eenvoudiger, maar veel nieuwssites blokkeren
het laden van extra scripts (Content-Security-Policy); een extensie heeft daar geen last van.

- **Knop en sneltoets:** klik op het speeedy-icoon of kies *Lees met speeedy* in het rechtsklikmenu.
- **In de pagina:** de extensie draait Readability op de pagina zoals jij die ziet, filtert de plaatjes en haalt
  de plaatjes op (de extensie mag dat; speeedy zelf niet).
- **Naar speeedy:** de extensie opent speeedy (lokaal of op de server — instelbaar in de extensie) en geeft het
  artikel door via een bericht dat alleen speeedy accepteert (controle op afzender en herkomst). Niets gaat naar
  een derde partij.
- **In speeedy:** het artikel komt binnen als nieuw document, met bron-url, titel en datum, en gaat direct naar de lezer.

**Raakt jetzt.** Er staat een plan om jetzt (de oude Chrome-extensie) te vernieuwen naar TypeScript, Lit en Manifest V3.
Deze extensie gebruikt dezelfde stack. Of het één extensie wordt (jetzt-opvolger met *Lees met speeedy*) of twee, is
open punt 1.

## Fase 2 — Url opgeven (route B)

- **In speeedy:** een tab *Url* naast *File* en *Text* op de startpagina; plak een adres, kies *Ophalen*.
- **Ophaaldienst:** een kleine dienst in dezelfde Docker-container als speeedy (`/fetch?url=…`). Doet alleen:
  pagina ophalen en teruggeven. Readability en het plaatjesfilter draaien daarna in speeedy zelf, met dezelfde code
  als de extensie.
- **Veiligheid van de ophaaldienst** (anders kan iemand er de interne server mee bevragen):
  - alleen `http`/`https`; geen adressen in het eigen netwerk (`localhost`, `10.x`, `192.168.x`, `100.64–127.x`
    van Tailscale, enz.), ook niet na een doorverwijzing;
  - maximaal 10 MB en 15 seconden per pagina, maximaal 5 doorverwijzingen;
  - alleen bereikbaar voor wie speeedy mag gebruiken (zelfde toegang als speeedy op de server);
  - geen opslag van opgehaalde pagina's of adressen in de dienst; geen logregels met de url.
- **Plaatjes** van het artikel lopen via dezelfde dienst (anders blokkeert de browser ze).

**Voorwaarde:** speeedy draait op de server (P620 of P920, Docker) — nog te regelen; zie het eerdere voorstel
(Dockerfile, compose, poort uit het poortregister, Traefik-route met certificaat).

## Fase 3 — Momentopname in het tabblad Origineel

- **Wat wordt bewaard:** de opgeschoonde HTML van het artikel (uit Readability) met de plaatjes als eigen bestanden,
  in de bestaande store `originals` (soort `html`, naast `pdf`).
- **Veilig tonen:** de momentopname wordt nog een keer gezuiverd (geen scripts, geen formulieren, geen externe
  verwijzingen behalve gewone links) en getoond in een afgeschermd kader zonder scripts (`iframe` met `sandbox`).
- **Plek en marks:** de koppeling van woord naar plek is hier eenvoudiger dan bij pdf: de tekst van de momentopname
  is dezelfde tekst die de lezer afspeelt. Huidig woord gemarkeerd, klikken = daar verder lezen, marks als bij pdf.
- **Bron:** bovenaan de momentopname de oorspronkelijke url, de titel en de datum van ophalen, met een link naar de
  live pagina.
- Dit is de tweede weergave achter de vaste koppeling uit fase 4 van het plan *Origineel* (`OriginalViewer`):
  `{ pdf: PdfViewer, html: HtmlSnapshotViewer }`.

## Tests

- Readability + plaatjesfilter op een paar opgeslagen voorbeeldpagina's (eigen fixtures, geen echte sites in de
  tests): menu's en zijbalk weg, artikelplaatjes blijven, reclameplaatjes (domein, formaat, kenmerk) weg.
- Extensie: artikel komt aan in speeedy; berichten van een andere afzender worden genegeerd.
- Ophaaldienst: interne adressen geweigerd, ook via doorverwijzing; grenzen voor grootte en tijd; geen url in de logs.
- Momentopname: geen scripts uitgevoerd; huidig woord en marks op de juiste plek; klik springt naar het juiste woord.

## Volgorde en omvang (schatting)

| Fase | Inhoud | Omvang |
|---|---|---|
| 1 | browserextensie: Readability, plaatjesfilter, doorgeven aan speeedy | 2–2,5 dagen |
| 2 | url opgeven + ophaaldienst (veilig) | 1,5 dag + uitrol op de server |
| 3 | momentopname in het tabblad Origineel, met plek en marks | 1,5–2 dagen |

## Open punten voor Eddie

1. Eén extensie (de jetzt-opvolger krijgt *Lees met speeedy* erbij) of twee aparte extensies?
2. Alleen Chrome, of ook Firefox? (Manifest V3 werkt in beide, met kleine verschillen.)
3. Waar draait speeedy op de server: P620 of P920? (Voorwaarde voor fase 2.)
