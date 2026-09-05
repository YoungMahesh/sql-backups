# 0001. Single Light Theme

## Status
accepted

## Context and Decision
The application previously included initial dark-mode styles via CSS media queries and ad-hoc Tailwind `dark:*` variant classes. Maintaining two parallel themes doubled styling complexity, complicated component maintenance, and introduced contrast inconsistencies across database exploration views.

We decided to completely remove dark-mode support, enforce `color-scheme: light` at the document and viewport levels, and standardize exclusively on a clean light theme.

## Considered Options
1. **Maintain both light and dark themes**: High maintenance overhead; required continuous auditing and dual styling for every new database visualization component.
2. **CSS suppression only (leave `dark:*` classes in components)**: Leaves dead code in JSX, creating confusion for future maintenance.
3. **Single light theme with full purge**: Removes all `dark:*` variants and media queries, providing a consistent, single source of truth for design tokens and contrast.

## Consequences
- All UI components are designed and tested exclusively for light mode.
- System/OS dark-mode preferences will not trigger dark styling; native browser inputs and scrollbars are explicitly kept in light mode via `color-scheme: light`.
- Future UI contributions should not add `dark:*` Tailwind classes.
