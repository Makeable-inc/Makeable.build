# Makeable — core design tokens

Paste this whole file into a new chat as design context.
Everything below is verified against the live landing page, not aspirational.

---

## 1. Star

The Makeable star is **8-pointed and hand-drawn** — traced from the wordmark in
`apps/landing/public/makeable-logo.png`. It is *not* a symmetrical asterisk and not a
4-point sparkle. Point lengths are deliberately uneven. Do not substitute `✦`, `✳`, or a
generated star; use this exact path.

```svg
<svg viewBox="0 0 100 100" fill="#e02d6c" aria-hidden="true">
  <path d="M63.8 0 63.3 35.6 98.4 27.5 70.9 49.3 100 61.7 66.5 66 70 100 52 74 43.2 88.7 38.5 71.2 8.5 85.6 28.6 57.5 0 42.5 31.5 40 22.7 9.6 46.3 30.6Z"/>
</svg>
```

- File: `apps/landing/public/makeable-star.svg`
- The path fills the full `0 0 100 100` viewBox, so `width`/`height` render at true size.
- **Pink `#e02d6c`** on light backgrounds; **white** on any coloured card.
- Sizes in use: `0.66em` beside a heading, `1.575rem` in a card corner.

---

## 2. Font — Fredoka

Fredoka is the wordmark face. Rounded, chunky, slightly handwritten. Already the
`--display` token in the root `styles.css`.

```ts
// next/font
import { Fredoka } from "next/font/google";
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
// <html className={fredoka.variable}>
```

```css
--font-display-stack: var(--font-display), "Arial Rounded MT Bold", ui-rounded, system-ui, sans-serif;
```

Google Fonts: `https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap`

| Role | Weight | Size | Tracking |
|---|---|---|---|
| Section heading (uppercase) | **600** | `clamp(1.4rem, 2.15vw, 2.05rem)` | `-.012em` |
| Sub-line (uppercase) | **400** | `clamp(.84rem, 1.29vw, 1.23rem)` | `.015em` |
| Card quote | **600** | `clamp(.94rem, 1.16vw, 1.1rem)` / 1.3 | `-.015em` |

The sub-line is **0.6× the heading at every breakpoint** — each clamp value is the
heading's × 0.6. Keep that ratio when resizing rather than hardcoding a size.

Body copy elsewhere on the landing page is still `Arial, Helvetica, sans-serif`.
Fredoka is display only.

---

## 3. Colours

Card accent colours rotate **blue → red → green**.

| Token | Hex | Use | Contrast vs white |
|---|---|---|---|
| Cobalt blue | `#0c4e9c` | card 1 | 8.1:1 |
| Brand red | `#df1749` | card 2, accents, focus rings, progress bar | 4.9:1 |
| Green | `#397552` | card 3 | 5.5:1 |
| Star pink | `#e02d6c` | the star only | — |

All three card colours take **white** text and a **white** star.

Supporting neutrals:

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#eee5d8` | page background |
| section paper | `#f6eee4` | section background |
| `--ink` | `#10264b` | body text, dark navy |
| — | `#101417` | headings |

⚠️ `--ink` `#10264b` is a deep navy and is **not** the cobalt. Use `#0c4e9c` for blue fills.

---

## 4. Copy-paste CSS block

```css
:root {
  --font-display-stack: var(--font-display), "Arial Rounded MT Bold", ui-rounded, system-ui, sans-serif;

  --mk-blue:  #0c4e9c;
  --mk-red:   #df1749;
  --mk-green: #397552;
  --mk-pink:  #e02d6c;

  --mk-paper:         #eee5d8;
  --mk-paper-section: #f6eee4;
  --mk-ink:           #10264b;
  --mk-heading:       #101417;
}
```

---

## 5. Gotcha

Tailwind v4 in `apps/landing` caches CSS aggressively. Edits to `globals.css` repeatedly
failed to appear on reload and looked like broken code. Clear and restart:

```bash
rm -rf apps/landing/.next
```
