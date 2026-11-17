# Cinema City Syria — online booking with a 3D "view from your seat"

An MVP demo of online ticket booking for **Cinema City (سينما سيتي), Damascus**. Customers pick a
film and a showtime, walk into a live 3D model of the hall, click a free seat — and the camera
flies into that seat, the lights go down and **the film's trailer starts on the screen**, so they
can look around from the seat (and hear the film) before they confirm.

Arabic-first (right-to-left) with a one-tap English switch, live seat availability across
devices, an e-ticket with a QR code, and a box-office dashboard for staff.

> Today Cinema City sells tickets only at the box office and by phone. This demo shows what an
> online channel could look like — with a feature no cinema in the region offers: choosing a seat
> by sitting in it.

---

## Quick start

Requirements: **Node.js 22.13 or newer** (developed on Node 24) and npm. No database server, no
internet connection and no API keys are needed — everything (fonts included) is self-hosted. The
one exception is optional: film trailers stream from YouTube, so they need internet access; offline,
the screen shows the film's still instead and everything else works the same.

```bash
npm install
```

**Presentation mode** — one process, production build, also reachable from phones on the same Wi-Fi:

```bash
npm run demo
```

Then open <http://localhost:4000>. The terminal also prints the LAN address (e.g.
`http://192.168.1.20:4000`) to open on a phone or a second laptop.

**Development mode** — hot reload for the web app and the API:

```bash
npm run dev
```

Then open <http://localhost:5173> (the API runs on port 4000 behind Vite's proxy).

| Page | URL |
| --- | --- |
| Home (now showing) | `/` |
| A film and its 7-day schedule | `/movies/the-last-caravan` |
| 3D seat selection | `/showtimes/<showtime-id>/seats` (open it from any showtime) |
| My tickets (this browser) | `/tickets` |
| Box office / staff dashboard | `/staff` — demo PIN **1234** |

---

## A five-minute demo script

1. **Home.** The hero rotates through featured films; the language button switches Arabic ⇄ English
   (the whole layout mirrors). Point out *"Pick your seat by sitting in it"*.
2. **Pick a film and a time.** Seven days of showtimes per film, with live seats-left and prices.
   Today's 8:15 PM show in Hall 1 is deliberately nearly full ("filling fast").
3. **The hall opens.** Velvet curtains part on a 3D model of a modern hall: acoustic panels cut with
   a Damascene star lattice, a crimson light line along the rake, surround speakers, leather seats.
   Sold seats have people in them; amber seats are being chosen by someone else right now. Drag to
   turn the hall, scroll to zoom.
4. **Click a free seat.** It is held for you (10-minute timer) and the camera flies into it.
   The house lights dim, the masking closes in and **the film's trailer plays on the screen, with
   sound** (if the browser starts it muted, one click on *Click to hear the trailer* fixes that).
   The heads in the rows in front really do block part of the picture. **Move the mouse to look
   around** (point at the left edge to look left), scroll to zoom, *Esc* to stand up — the trailer
   pauses and picks up where it left off when you sit down again. The speaker button mutes it. The
   card shows the seat's view score and why (how much of your view the screen fills, how far
   off-centre you are).
5. **Compare seats.** Add a second seat; hop between them from the tray at the bottom — or press
   **Best seat for me** to be seated in the free seat with the best view.
6. **Show it is live.** Open the same showtime on a second device (or the staff dashboard's
   *Open live hall*): seats you pick turn amber there within a second; when the hold times out they
   free up everywhere.
7. **Checkout.** Name and Syrian mobile number, then *pay at the box office* (the cinema's current
   practice) or a simulated e-wallet payment.
8. **E-ticket.** Booking reference, QR code, add-to-calendar, print, cancel — and **See the view
   from my seat**, which reopens the hall seated in the booked seat.
9. **Staff dashboard** (`/staff`, PIN 1234). Live tickets sold, revenue and occupancy per show; type
   the booking reference to check the customer in at the door. *Reset demo data* restores a fresh,
   realistic state before the next presentation.

Tips: present from `npm run demo` on a laptop (no reliance on venue Wi-Fi), in Chrome or Edge, with
the window maximised. Phones work too (drag to look around, pinch to zoom).

---

## What is real and what is illustrative

| Area | In the demo | Source / how to make it real |
| --- | --- | --- |
| Halls | Hall 1: 280 seats (14 rows × 20); Hall 2: 180 seats (12 × 15); straight rows, side aisles, digital 3D. | Seat counts are from press reports; row-by-row layouts and room dimensions are approximations. Edit `shared/halls.ts` with the surveyed plans — the 3D model, seat map, validation and prices all follow. |
| Hall interior | A modern black-box design: graphite acoustic panels with a Damascene star lattice, crimson and warm-white light lines, surround speakers, leather seats with cup holders, a masked scope screen without curtains. | A design proposal in the cinema's colours, not a survey. Colours live in `src/three/palette.ts`; the room in `src/three/hall/architecture`. |
| Trailers | Each now-showing film has a YouTube trailer that plays on the 3D screen when you sit down. The films are fictional, so the links are **stand-ins**: short open movies by the Blender Foundation (Creative Commons Attribution). | Paste the real trailer's YouTube link into the film's `trailer:` in `server/data/catalog.ts` — any link YouTube gives you works (watch, youtu.be share link, embed, Shorts, with `?t=` start time). Restart the server. |
| Premium seats | A "sweet spot" zone priced higher. | The cinema currently sells one flat price. Delete the `zones` in `shared/halls.ts` to sell every seat at one price. |
| Prices | Standard 750, premium 1,000 new Syrian pounds; +100 for 3D glasses. | Based on the published 75,000 old-pound (750 new) ticket and 10,000 old (100 new) 3D glasses. Edit `server/data/pricing.ts`. |
| Show times | 1:30, 3:45, 6:00, 8:15, 10:30 PM (Hall 1) and 1:45, 3:30, 5:15, 7:30, 9:45 PM (Hall 2). | Mirrors the cinema's published weekly schedule. Edit `server/data/schedule.ts`. |
| Films | 11 **fictional** films with original artwork (no third-party posters). | Replace `server/data/catalog.ts` and the SVGs in `public/posters` and `public/backdrops`, then `npm run db:reset`. |
| Bookings | Seeded sample bookings so halls look lived-in (marked "sample" in the dashboard). | Turn off with `SEED_BOOKINGS=0`. |
| Payment | *Pay at the box office* (real-world default) and a **simulated** e-wallet payment — no money moves. | Integrate a Syrian wallet or bank gateway (e.g. Sham Cash, Syriatel Cash, a licensed e-payment gateway) behind the payment step. |
| Logo | A stand-in skyline emblem in the brand colours. | Replace with the official artwork (`src/components/brand/Logo.tsx`, `public/brand/favicon.svg`). |
| Staff login | A shared PIN (demo-grade). | Real staff accounts and roles before going live. |

---

## How it works

```
 Browser (React + three.js)                         Node server (Express + SQLite)
 ─────────────────────────────                      ─────────────────────────────────
 Home / Film pages ── GET /api/movies ───────────▶  catalogue + 7-day schedule
 3D hall ──────────── GET /api/showtimes/:id ────▶  hall layout + seat map
          ◀────────── SSE /api/showtimes/:id/events  live seat changes (held / booked / free)
 click a seat ─────── POST …/holds {seatId} ─────▶  10-minute hold, sliding expiry
 checkout ─────────── POST /api/bookings ─────────▶ atomic booking, QR e-ticket
 staff dashboard ──── /api/admin/* (PIN) ─────────▶ occupancy, revenue, check-in, reset
```

- **One hall model, three views.** `shared/hall.ts` turns a declarative layout (rows, seats per
  block, rake, screen size) into exact seat positions and eye points. The server uses it to validate
  seats and price them; the 3D scene, the 2D seat map and the "view score" all derive from it, so
  they can never disagree.
- **The view from a seat** is a real camera at a seated eye height (1.19 m above that row's floor),
  facing the centre of the screen. The view score combines how much of your field of view the screen
  fills, how far off-centre you sit and how much you must look up or down.
- **Seat lifecycle:** `available → held (10 min, extended on each new seat) → booked`, or back to
  available on release, expiry or cancellation. The database enforces "never two bookings for one
  seat" with a unique index; every change is pushed to every open browser over Server-Sent Events.
- **The screen** behaves like a real one: the house lights wash out the pre-show picture, the
  projector is brightest in the middle, black velour masking frames the picture and glides in to
  frame a 16:9 trailer on the 2.39:1 scope screen, and the picture's light flickers across the room.
- **The trailer on the 3D screen.** A YouTube video cannot be drawn into WebGL (the player is a
  cross-origin iframe), so the official YouTube player sits *behind* a transparent canvas, placed
  with a CSS 3D transform computed from the same camera (three's `CSS3DRenderer`) so it lines up with
  the screen exactly. The screen's shader opens a window onto it; everything in front of the screen
  stays opaque, so heads in the rows ahead hide the picture as they would in the hall. The player loads
  during the fly-in (privacy-enhanced `youtube-nocookie.com` mode), starts once you are seated,
  pauses when you stand, and falls back to muted playback plus a "click for sound" button where the
  browser blocks sound. If YouTube cannot be reached, the still stays on screen.
- **Performance:** all seats of a hall are drawn with a handful of instanced meshes (a few draw
  calls whatever the size), the resolution adapts to the GPU, and the 3D engine is loaded only when a
  hall is opened. Without WebGL the accessible 2D seat map takes over.

### Project layout

```
shared/            hall geometry, halls, DTO types, business rules, YouTube links (client and server)
server/            Express API, SQLite (node:sqlite), live seat stream, seeding, tests
  data/            catalogue, schedule and pricing — edit these to change the programme
src/
  pages/           Home, Film, Seats (3D), Checkout, Ticket, My tickets, Staff
  three/           3D hall: architecture, screen & lighting, seats, camera rig, trailer projection
  store/booking.ts the seat-selection state machine (holds, live updates, camera mode)
  i18n/            Arabic and English dictionaries (typed: a missing key fails the build)
docs/openapi.yaml  the HTTP contract
public/            film artwork, favicon
```

---

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_PORT` / `PORT` | `4000` | Server port (in `npm run dev` only `API_PORT` is used; Vite stays on 5173) |
| `HOLD_MINUTES` | `10` | How long selected seats are held before checkout |
| `ADMIN_PIN` | `1234` | Staff dashboard PIN |
| `DB_FILE` | `data/cinema.db` | SQLite database file |
| `SEED_BOOKINGS` | `1` | Generate sample bookings (`0` = start with empty halls) |

`npm run db:reset` deletes the database and rebuilds it from the code (films, halls, schedule,
sample bookings). The staff dashboard's *Reset demo data* does the same without a restart.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web app with hot reload (http://localhost:5173) |
| `npm run demo` | Production build served by the API (http://localhost:4000) |
| `npm run build` / `npm start` | Build the web app / start the server |
| `npm test` | Unit and API integration tests (Vitest + Supertest) |
| `npm run typecheck` | TypeScript check of the whole project |
| `npm run db:reset` | Recreate the database with fresh demo data |

---

## Technology choices

| Need | Choice | Why |
| --- | --- | --- |
| UI | React 19, TypeScript, Vite | Mature, fast to iterate, one language end to end |
| 3D | three.js via React Three Fiber + drei | The standard for real-time 3D on the web; runs in any modern browser, no plug-ins |
| Styling | Tailwind CSS 4 with logical (RTL-aware) utilities | One codebase mirrors cleanly between Arabic and English |
| State | Zustand | Small, explicit store shared by the 3D scene and the HUD |
| Server | Node + Express 5 | Simple, well understood, easy to host anywhere |
| Database | SQLite (built into Node) | Zero setup for the demo; a seat-level unique index prevents double booking. Swap for PostgreSQL in production |
| Live updates | Server-Sent Events | One-way push of seat changes; works through proxies, auto-reconnects |
| Trailers | YouTube IFrame Player API (privacy-enhanced mode) + three's CSS3DRenderer | Distributors already publish trailers on YouTube; its player handles streaming, quality and rights, so there is nothing to host. Loaded only when someone sits down |
| Fonts | Alexandria, IBM Plex Sans Arabic, IBM Plex Mono — bundled | Excellent Arabic and Latin; no Google Fonts dependency (unreliable from Syria) |

---

## Towards production

- Real payments (Syrian e-wallets or a licensed gateway) and SMS confirmation of bookings.
- Staff accounts and roles; a back office to publish films, showtimes and prices.
- Surveyed hall plans; wheelchair and companion spaces; a rule against isolated single seats.
- Hosting reachable from Syria (a local VPS rather than services blocked in the region), HTTPS,
  backups, PostgreSQL, monitoring.
- Offline-capable e-tickets (installable web app) and wallet passes.

---

*Demonstration build. All films, people and bookings in it are fictional sample data.*
