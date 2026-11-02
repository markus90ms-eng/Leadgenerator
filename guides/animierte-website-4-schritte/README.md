# Animierte Websites in 4 Schritten

Quelle: Guide von Alan Langhammer (@alan.buildz), „Website-Setup“, Juli 2026, guides.alanbuildz.com.
Original: [`animierte-website-4-schritte.pdf`](animierte-website-4-schritte.pdf). Dies ist die Abschrift zum schnellen Nachschlagen.

**Kernidee:** Vier Bausteine zusammen ergeben Seiten, die nicht nach „AI-Slop“ aussehen: Claude Code (Bauarbeiter), Motion (Animationen), Taste-Skill (Geschmack), 21st.dev (Vorlagen).

## Schritt 1: Claude Code installieren
- Mac/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Im Projektordner `claude` starten, Anmeldung im Browser. Prüfen mit `claude --version`, Diagnose mit `claude doctor`.
- Braucht Pro, Max, Team oder Enterprise (der kostenlose Account reicht nicht).

## Schritt 2: Claude mit Motion verbinden
- Bibliothek: `npm install motion`, Import im Code: `import { motion } from "motion/react"`.
- Wissen für Claude (Skill): `npx -y skills add mindrally/skills --skill framer-motion --agent claude-code`
  - Regeln: spring statt fester Dauer, nur `transform` und `opacity` animieren, `AnimatePresence` für Exit-Animationen, `useScroll` für Scroll-Effekte, `prefers-reduced-motion` respektieren.
- Offizieller Weg: Motion AI Kit (MCP-Server, Doku, Performance-Check), Installer `npx motion-ai`, braucht einen Motion+-Key (Einmalzahlung), am Anfang nicht nötig. Infos: motion.dev/docs/ai-kit-install
- Namens-Chaos: „Framer Motion“ heißt seit v11 nur noch **Motion**; das Paket heißt `motion`, Import über `motion/react`. Nicht `framer-motion` installieren lassen.

## Schritt 3: Taste-Skill gegen AI-Slop
Verbietet Standard-Looks (zentrierte Überschrift auf dunklem Verlauf, drei gleiche Karten, lila Button) und zwingt Claude, erst den Auftrag zu lesen und dann eine Design-Richtung zu wählen.
- Weg 1, Claude installiert es: „Installier mir bitte den Taste-Skill für Frontend-Design in dieses Projekt. Der Befehl dafür ist: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`. Führ ihn aus, zeig mir danach, wo die SKILL.md gelandet ist, und fass mir in 5 Zeilen zusammen, welche Design-Regeln du ab jetzt befolgst.“
- Weg 2, selbst: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` (landet als SKILL.md im Projekt).
- **Pro-Tipp:** Die Richtung vorgeben, nicht das Layout. Z. B. „Linear-clean für technische Käufer“ oder „Awwwards-experimentell für eine Kreativagentur“ statt „mach’s schön“.

## Schritt 4: 21st.dev (der Unterschied)
Bibliothek fertiger Website-Bausteine (Hero, Pricing, Navigation, Testimonials). Jede Komponente hat einen **„Copy prompt“**-Knopf; den Text in Claude Code einfügen, Claude baut sie in eigenen Farben und Schrift nach.
1. Hero-Sektion aussuchen, „Copy prompt“, in Claude Code einfügen.
2. Dasselbe für eine Pricing-Sektion.
3. Erst wenn beide stehen, den Feinschliff-Prompt unten ausführen.
- Browsen kostenlos, 2 Komponenten-Kopien pro Tag gratis. Alternativ je Komponente ein shadcn-CLI-Befehl.
- **Nur zwei Sektionen, nicht zehn:** Hero und Pricing, vereinheitlichen, dann die nächste.

### Feinschliff-Prompt (nach Hero und Pricing)
```
Du hast jetzt die Hero-Sektion und die Preis-Sektion im Projekt.
Mach daraus eine zusammenhängende Seite:
1. Design-Lesart zuerst: sag mir in EINEM Satz, für wen diese Seite ist und welche Design-Richtung du wählst. Mein Kontext: [Angebot + Zielgruppe + Vibe in 2 Sätzen]
2. Vereinheitliche Typografie, Abstände und Farben über beide Sektionen – eine Schriftfamilie, eine Akzentfarbe, eine Abstands-Skala.
3. Animier mit motion/react: Hero-Elemente gestaffelt einblenden, Preiskarten beim Reinscrollen. Nur transform und opacity, spring statt fester Dauer, und respektier prefers-reduced-motion.
4. Mach es mobil zuerst richtig, dann Desktop.
5. Zum Schluss: kritisier dein eigenes Ergebnis in 5 Punkten und behebe die zwei schlimmsten selbst.
Erklär mir kurz, was du geändert hast – und lauf danach einmal den Dev-Server, damit ich es sehe.
```

## Bonus: Must-have-Skills
1. **shadcn-MCP:** `npx shadcn@latest mcp init --client claude`. Claude sucht und installiert Komponenten selbst.
2. **Chrome-DevTools-MCP:** `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`. Claude öffnet die Seite im Browser, macht Screenshots, liest die Konsole, findet ruckelnde Animationen. Laut Guide der wichtigste.
3. **Motion AI Kit:** `npx motion-ai` (Animations-Check, Motion+-Key nötig, lohnt erst bei regelmäßigem Bauen).
4. **Anthropic Skills Marketplace:** in Claude Code `/plugin marketplace add anthropics/skills`, dann `/plugin install document-skills@anthropic-agent-skills` (PDFs, Word, Präsentationen).
5. **CLAUDE.md:** Datei im Projektordner mit Schriftart, Akzentfarbe, Framework, Deploy-Ziel (drei Zeilen reichen).

## Der eine Fehler
Schritt 3 und 4 überspringen und sich über Schritt 1 wundern: Standard-Look kommt zurück. Geschmack kommt aus dem Input: Skill = Regeln, 21st.dev = Vorlage, Design-Lesart = Richtung.

## Beim ersten Mal beachten
- Ein Projekt, ein Ordner (nicht im Home-Ordner starten).
- Kleine Schritte, nach jeder Sektion im Browser prüfen.
- Sagen, wenn es hässlich ist („Das wirkt generisch, geh weg vom zentrierten Hero“).

## Die nächsten 20 Minuten
1. Claude Code installieren, `claude --version`. 2. `npm install motion` plus Motion-Skill. 3. Taste-Skill über den Prompt installieren. 4. Auf 21st.dev eine Hero-Sektion kopieren und reinwerfen.

---
*Hinweis zu unserem Stand:* Die Repos Leadgenerator und Fame_App sind kein React-Projekt. Dort nutzen wir Motion als Vanilla-Bibliothek (`landing/vendor/motion.js` in Fame_App) statt `motion/react`, und 21st.dev/shadcn nur als Inspiration.
