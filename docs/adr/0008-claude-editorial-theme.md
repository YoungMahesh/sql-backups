# 0008. Claude Warm-Canvas Editorial Theme

## Status
accepted (reinforces and extends [0001-single-light-theme.md](./0001-single-light-theme.md))

## Context and Decision
The application previously used a generic Tailwind zinc/neutral color scheme. To establish a distinct, elegant, and humanist identity for database inspection and backup tooling, we adopted the Claude warm-canvas editorial design system documented in [DESIGN.md](../../DESIGN.md).

We decided to anchor the application on a warm tinted cream canvas (`#faf9f5`), warm coral primary CTAs (`#cc785c`), hairline borders (`#e6dfd8`), and an editorial typography pairing of Cormorant Garamond (display headlines), Inter (body/UI), and JetBrains Mono (code/SQL).

The application strictly preserves the single-light-mode invariant (no OS or toggle dark mode for the application canvas). As a deliberate design choice for developer product chrome, high-contrast `#181715` dark navy surfaces (`code-window-card`) are reserved specifically for raw SQL dumps, DDL schema inspection, and terminal code blocks.

## Considered Options
1. **Pure light-mode everywhere (including code blocks)**: Eliminated all dark surfaces, but reduced syntax readability and contrast for complex SQL dumps and table schemas.
2. **Generic cool-slate modern SaaS theme**: Standard blue/slate color palette; felt generic and failed to convey the premium, literary editorial aesthetic.
3. **Claude Editorial Hybrid (Selected)**: Light-mode cream canvas (`#faf9f5`) across all pages and sheets, with high-contrast `#181715` code windows for developer inspection chrome.

## Consequences
- The application canvas is permanently `#faf9f5`, with no dark mode toggle or automatic OS dark mode switching.
- Typography uses Cormorant Garamond for display titles, Inter for body/navigation, and JetBrains Mono for code.
- Primary actions consistently use warm coral (`#cc785c`), active states use `#a9583e`, and subtle hairline borders use `#e6dfd8`.
- Status indicators use the Claude semantic palette (`#5db872` success, `#d4a017` warning, `#c64545` error, `#5db8a6` teal) in soft pill badges.
- All future UI components must adhere to the tokens defined in `DESIGN.md` and `app/globals.css`.
