# PROJECT ARCHITECTURE & DESIGN SYSTEM RULES

## 1. System Logging & Data Integrity
- **High-Precision Timestamps**: Record all system events, telemetry, user activity, and audit logs down to the millisecond. Store in UTC using ISO 8601 only: `YYYY-MM-DDTHH:mm:ss.SSSZ` (e.g., `2026-10-22T08:15:30.123Z`). In SQLite use `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- **Standardized Unique IDs**: Assign unique, immutable primary identifiers (`UUIDv4`) to every record across SQLite3 tables.

## 2. Offline Asset Bundling & Performance
- **Zero External CDNs**: Self-host all stylesheets, scripts, fonts, and icons locally inside `/static/`. Do not import anything from external CDNs.
- **Offline First**: The entire web app and layout must function 100% offline inside Docker containers or local LAN servers.
- **No Runtime Internet Dependency**: Do not call public APIs to render the interface. Optional external data must have a local fallback and must not block core screens.
- **Iconography Standard (Strictly No Emojis)**: Never use system emoji characters. Use local SVG vector icons only. All SVGs must inherit text colors via `currentColor`.
- **Self-Hosted Fonts**: Load fonts locally with `font-display: swap`. Include a favicon.

## 3. Layout, Toasts & UI States
- **Responsive Web Design**: Use Bootstrap 5 / CSS Grid / Flexbox. Layouts must scale across mobile, tablet, laptop, and large wall displays without breaking.
- **Narrow Navigation**: Keep every navigation destination reachable on small screens; compact the sidebar rather than clipping page content.
- **Dynamic Toast Notifications**: Non-intrusive toast popups in 4 variants: `Success` (Green), `Error` (Red), `Warning` (Yellow), `Info` (Blue). Auto-dismiss after 5s, max 3 stacked, use `aria-live`.
- **UI Component States**: Every data view must handle 4 states: Default, Loading (skeletons/spinners), Empty (no records notice), Error (retry option).

## 4. Universal Pagination & Search
- **Standard Pagination Context**: All paginated endpoints return `items`, `total`, `page`, `limit`, `total_pages`. Reuse a single pagination template across all views. Max `limit` is 100. Filters, sort, and page persist in the URL.
- **Debounced Search**: Live search input debounces typing by 300ms before querying SQLite.
- **Responsive Tables**: Wrap all `<table>` elements in `<div class="table-responsive">`. Sortable headers where applicable.

## 5. Standardized Button Architecture
- **Visual Hierarchy**: Primary (CTA, max 1 per visible section), Secondary (Neutral/Cancel), Destructive (Red, requires confirmation modal).
- **Double-Submit Protection**: On submit, buttons enter a disabled loading state with a local spinner and active text (e.g., "Saving...").

## 6. Centralized Customization (Single Source of Truth)
- **Central Config File (`app/config.py`)**: Store global site title, logo paths, navigation links, and default pagination limits in one file.
- **CSS Variables First (`static/css/theme.css`)**:
  - NO hardcoded inline styles or hex colors in HTML/Jinja files.
  - Define all colors, font sizes, radii, and spacing as root CSS variables (`:root`) in `theme.css`.
  - Updating a single token in `theme.css` or `config.py` must instantly update styling across the entire site.

## 7. Basic Form Handling & Modals
- **Inline Validation**: Display field errors directly below the input (`invalid-feedback`). Mark required fields with `*`.
- **Modal Lifecycle**: All modals close via `ESC`, backdrop click, or close button. Never overlap multiple modals.

## 8. Core Essential Design Rules
- **High Contrast Readability**: Never use light grey text on light backgrounds.
- **Muted Text Contrast**: Muted text must still meet a minimum 4.5:1 contrast ratio against its background.
- **Unified Corner Radii**: One border-radius variable (e.g., `6px` or `8px`) applied across buttons, inputs, cards, and modals.
- **Adequate Touch Targets**: Interactive controls, icon buttons, and list items at least 40px in height/width.
- **Font Weight Hierarchy**: Bold (600-700) for headers, Medium (500) for labels/buttons, Regular (400) for body text, muted text for sub-captions.
- **Interior Container Padding**: At least 16px inside cards, modals, and panels.
- **Accessibility Basics**: Visible focus outline, `aria-label` on icon-only buttons, respect `prefers-reduced-motion`.

## 9. Page Layout & Structural Alignment
- **Clear Page Title Anchor**: Every page has a prominent title at the top-left of the content area.
- **Max Content Width**: Wrap page content in a centered container (`max-width: 1400px` / `container-xl`).
- **Consistent Color Semantics**: Green (Positive/Active), Red (Error/Destructive), Yellow (Warning/Pending), Blue (Primary/Links).
- **12-Column Grid Alignment**: Align content, cards, and forms to 12-column tracks (`col-12`, `col-md-6`, `col-lg-4`).
- **Sticky Top Header**: Main navigation header is sticky at the top (`sticky-top`).
- **Active Navigation Highlighting**: Clearly highlight the active page in the navigation bar.
- **Consistent Capitalization**: Sentence case for all buttons, labels, and table headers.
- **Error Pages**: Simple custom 403, 404, and 500 pages using the same layout.

## 10. Media, Element Spacing & Visual Softness
- **Fluid Media & Logos**: All logos and images use `max-width: 100%` and `height: auto`.
- **Explicit Element Separation**: Cards, form inputs, and stacked buttons always have explicit gaps (`mb-3` or `gap-3`).
- **Consistent Pointer Cues**: `cursor: pointer` on all custom interactive elements.
- **Soft Section Dividers**: Subtle 1px light-grey borders via the `--border-soft` token.
- **Off-Black Text**: Dark grey body text via the `--text-body` token instead of pure black (`#000000`).

## 11. Development Rules
**Phase 1 (now)**
- Use Flask blueprints, one per module.
- One reusable `pagination.html` macro and one central error handler.
- One helper for date, number, and currency (₱) formatting. Store UTC, display Asia/Manila (UTC+8).
- Config values come from `.env`; `DEBUG=False` in production.
- Parameterized SQL queries only; keep Jinja autoescape on.

**Phase 2 (later)**
- Security: CSRF tokens, password hashing (argon2/bcrypt), session timeout, role-based access, security headers.
- SQLite: `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`, migrations, indexes, backup/restore, soft delete (`deleted_at`), standard columns (`created_at`, `updated_at`, `created_by`).
- Logging: rotation, retention, never log passwords or sensitive data.
- Docker: DB on a mounted volume, `HEALTHCHECK`, non-root user, pinned versions.
- Extras: CSV/PDF export, unsaved-changes warning, print stylesheet.
