# Cinema City Syria — Technical Proposal

**3D hall simulation and online booking platform**

**Prepared for:** Cinema City (سينما سيتي), Damascus · **Prepared by:** [Company name]\
**Date:** November 2026 · **Version:** 1.0 (draft for discussion) · **Currency:** USD, excluding taxes

| Contents | |
|---|---|
| 1. [Summary](#1-summary) | 8. [Database design](#8-database-design) |
| 2. [Scope and assumptions](#2-scope-and-assumptions) | 9. [Booking APIs](#9-booking-apis) |
| 3. [Customer experience](#3-customer-experience) | 10. [Development phases and team](#10-development-phases-and-team) |
| 4. [3D scanning requirements](#4-3d-scanning-requirements) | 11. [Estimated costs](#11-estimated-costs) |
| 5. [Equipment](#5-equipment) | 12. [Project deliverables](#12-project-deliverables) |
| 6. [From scan to seat view](#6-from-scan-to-seat-view) | 13. [Risks and mitigation](#13-risks-and-mitigation) |
| 7. [Software architecture](#7-software-architecture) | 14. [Next steps](#14-next-steps) |

---

## 1. Summary

| Topic | In short |
|---|---|
| **Goal** | Build an exact 3D model of every hall, so customers see the real view of the screen from any seat before they buy. |
| **Starting point** | The working demo (this repository): 3D hall, view from any seat, live seat holds, booking, QR e-ticket, staff dashboard. It uses *approximate* hall plans. |
| **What we add** | Laser scans of both halls → exact seats and screen → realistic seat views. Plus real payments, SMS, staff accounts, a back office and production hosting. |
| **Timeline** | About 5 months: go-live in week 18, then 4 weeks of support. |
| **One-off cost** | About **$76,000** for 2 halls and 460 seats (likely range 65,000–87,000). |
| **Running cost** | About $80–250 per month for hosting, plus SMS and payment fees and an optional support plan. |

---

## 2. Scope and assumptions

**In scope**
- 3D scan and digital twin of every hall: Hall 1 (280 seats) and Hall 2 (180 seats).
- A realistic view of the screen from every seat, both as live 3D and as a pre-rendered photo.
- A production booking platform: customer web app (Arabic/English), booking API, back office, box-office mode and door scanner.
- Online payments (local e-wallet or gateway), SMS/WhatsApp messages, staff accounts and roles.
- Hosting, monitoring, backups, training, launch and 4 weeks of support.

**Out of scope** (can be quoted separately)
- Native iOS/Android store apps. The web app installs on the phone instead (PWA).
- Food and drink ordering, loyalty points, gift cards.
- Hardware at the cinema: PCs, ticket printers, network.

**Assumptions** (to confirm in Discovery)
- One site with two halls. Another hall (for example the VIP lounge concept in the demo) adds about $2,000 if it is scanned in the same visit.
- The cinema gives access to each hall for half a day, plus the seat plans, seat numbering, logo and film artwork.
- The cinema opens the accounts with the chosen payment and SMS providers.
- The new platform is the only source of seat availability, for web, box office and phone bookings alike.
- Costs use a blended regional team rate of **$2,500 per person-month**.

---

## 3. Customer experience

`Film → showtime → 3D hall → tap a seat → sit in it and look around → log in with phone → pay → QR e-ticket`

| Feature | Demo today | After this project |
|---|---|---|
| 3D hall and view from any seat | Approximate hall | Exact scanned hall, realistic look |
| View score and "Best seat for me" | Yes | Calculated from real measurements |
| Live seat holds (10 minutes) | Yes | Yes, tested for premiere-night traffic |
| Low-data mode (seat-view photo) | No | Yes |
| Wheelchair and companion seats | No | Yes |
| Login | None (browser session) | Phone number + one-time code |
| Payment | Pay at box office, or simulated | Pay at box office, or a real e-wallet / gateway |
| E-ticket | QR on screen | QR by SMS/WhatsApp, works offline |
| Staff tools | One shared PIN | Accounts and roles, back office, box office, door scanner |

---

## 4. 3D scanning requirements

### 4.1 What we capture in each hall

| Element | What we record | Accuracy |
|---|---|---|
| Screen | 4 corners, curve, height above the floor, masking for Flat (1.85:1) and Scope (2.39:1) | ±1 cm |
| Seats | Every seat: row, number, position, height, type, wheelchair spaces | ±2 cm |
| Room | Floor and steps (rake), aisles, walls, ceiling, exits | ±2 cm |
| Look and materials | 360° HDR photos at every scan point; close-ups of the seat, carpet, walls and screen frame | 20 MP+ photos |
| Reference photos | Photos from 5 marked seats per hall, with a test grid on the screen | Used to prove accuracy |

### 4.2 Scan plan (per hall)
- 20–30 scanner positions: front, back, side aisles and every 3 rows or so.
- Targets placed around the room to join the scans. Key distances double-checked with a laser meter.
- Both masking positions captured, if the screen masking moves.
- About 4 hours on site per hall, so both halls take 2 mornings (plus 1 spare day).

### 4.3 What we need from the cinema
- Each hall free for about 4 hours, for example a morning before the first show.
- House lights at full, and the projector able to show a white image and a test grid.
- The current seat plan and seat numbering (as printed on the seats and tickets).
- One staff member on site, and permission to photograph.

### 4.4 Scan outputs (per hall)
Joined point cloud (E57), 360° panoramas, floor plan and section (PDF/DXF), seat coordinates (JSON/CSV) and an accuracy report.

---

## 5. Equipment

| Item | Recommended | Used for | Est. cost (USD) |
|---|---|---|---|
| Laser scanner | Leica BLK360 G2 (or FARO Focus) | Millimetre-level geometry of the room, seats and screen | Rent ≈ 3,000/week incl. shipping · buy ≈ 20,000 |
| Camera | Full-frame mirrorless, 16–35 mm lens, tripod | Textures and reference photos | ≈ 2,500 |
| 360° camera | Insta360 X5 or Ricoh Theta Z1 | Quick panoramas, documentation | ≈ 500 |
| Laser distance meter | Leica DISTO D2 or X4 | Checking screen and row sizes | ≈ 300 |
| Accessories | Scan targets, LED panels, spare batteries | Steady, well-lit capture | ≈ 200 |
| Workstation | 16-core CPU, 64–128 GB RAM, RTX 5080/5090-class GPU, 4 TB SSD | Joining scans, modelling, rendering | ≈ 4,000 |
| UPS and backup drives | 1.5 kVA UPS, 2 × 4 TB SSD | Protection from power cuts, safe copies | ≈ 500 |

**Software**

| Task | Software | Licence |
|---|---|---|
| Join the scans | Leica Cyclone REGISTER 360 or FARO SCENE | Subscription, ≈ $1,500–2,500/year |
| Clean the point cloud | CloudCompare | Free |
| Mesh and photo textures | RealityScan (Epic) or Agisoft Metashape | RealityScan: free under $1M revenue · Metashape: ≈ 3,500 USD |
| Optimise, model the seat, batch renders | Blender + Python scripts | Free |
| Compress for the web | glTF-Transform (Meshopt, KTX2) | Free |

**Recommendation:** rent the scanner, don't buy it. Each hall is scanned once, and again only after a renovation. If bringing a scanner into Syria is slow, hire a regional scanning company instead; the cost is similar.

*Budget option:* a Matterport Pro3 (≈ $6,000) or an iPad Pro with LiDAR is faster and cheaper, but only accurate to ±2–5 cm. Fine for a quick pilot, not for the final model.

Prices are market estimates; we confirm them with supplier quotes before ordering.

---

## 6. From scan to seat view

### 6.1 Processing pipeline

| # | Step | Tools | Result |
|---|---|---|---|
| 1 | Scan the hall | Scanner, cameras | Raw scans and photos |
| 2 | Join and clean the scans | Cyclone/SCENE, CloudCompare | Point cloud, error ≤ 1 cm |
| 3 | Build the room | RealityScan/Metashape, Blender | Photo-textured room model |
| 4 | Model the seat once | Blender (from photos and scan) | One accurate seat, reused for every seat |
| 5 | Survey every seat and the screen | Python script + manual check | Exact seat and eye positions |
| 6 | Optimise for phones | Blender, glTF-Transform | Room ≤ 8 MB; a version under 1 MB shows first |
| 7 | Render one view per seat | Blender batch script | 460 seat-view images, ≈ 150 KB each |
| 8 | Validate against real photos | 5 reference seats per hall | Accuracy report |
| 9 | Publish | Back office, "Hall versions" | Live in the app; old versions kept |

Effort per hall: about 1 day on site and 6 working days of processing.

Each hall version is delivered as one **hall package**:

```
hall-1/v2/
├── hall.json       screen corners, rows, seats (position, eye point, type), aisles
├── room.glb        the scanned room (Meshopt + KTX2 textures)
├── seat.glb        the seat model, repeated for every seat
├── views/F12.webp  one image per seat (low-data mode and sharing)
└── report.pdf      accuracy and validation
```

The demo already drives the 3D scene, seat map, view score, seat validation and prices from **one hall model** (`shared/hall.ts`). We extend it to read the surveyed seats from `hall.json` instead of generating perfect rows, so everything stays consistent.

### 6.2 What makes the view realistic

| Factor | How |
|---|---|
| Exact geometry | Seats, steps and screen taken from the scan (±1–2 cm) |
| True eye point | Seated eye height above that row's floor: 1.19 m (1.14 m in recliners), checked on site |
| Natural field of view | The same human-like view angle for every seat, so seats compare fairly |
| Real look | Photo textures from the hall itself, and the real seat model |
| Cinema lighting | House lights dim; the screen glows and lights the room |
| The film itself | The current film's still or trailer on the screen, in its real format (Flat/Scope) |
| People in front | Optional "full house" view with average-height heads, to show any blocking |
| Proven | Simulated views compared with real photos from 5 reference seats per hall |

### 6.3 View score

Each seat gets a score from 0 to 100: Excellent (90+), Great (76+), Good (60+) or Fair. The demo already does this; now it uses real measurements.

| Measure | Meaning | Best |
|---|---|---|
| Screen angle | How wide the screen looks | 44°–54° |
| Off-centre | Angle away from the screen's centre line | ≤ 6° |
| Head tilt | Looking up or down at the screen centre | −6° to +8° |
| Sightline clearance (new) | How far your line of sight passes above the eyes of the person in front | ≥ 12 cm (clears their head) |

### 6.4 Two ways to see the view

| Mode | What the customer gets | Download | Best for |
|---|---|---|---|
| Live 3D | Sit in the seat, look around, film on the screen | Under 1 MB to start, ≈ 8 MB full detail, then cached | Most phones and computers |
| Seat-view photo | A pre-rendered image from that exact seat | ≈ 150 KB | Slow internet, older phones, sharing on WhatsApp |

Each photo stores where the screen's four corners are, so the app can place the current film's still on the screen. One image works for every film.

*Later option:* "Gaussian splat" capture gives near-photographic 3D, at the cost of larger downloads.

---

## 7. Software architecture

### 7.1 Overview

```
┌──────────────────────────────────────────────────────────────┐
│ APPS         Customer web app / PWA (Arabic + English, 3D)   │
│              Back office · Box office · Door scanner         │
├──────────────────────────────────────────────────────────────┤
│ API          Node.js + Express (TypeScript), REST + live SSE │
│              Catalogue · Halls · Holds · Bookings · Payments │
│              Customers (OTP) · Staff and roles · Reports     │
├──────────────────────────────────────────────────────────────┤
│ DATA         PostgreSQL: films, halls, seats, bookings       │
│              File store: hall packages and artwork (cached)  │
├──────────────────────────────────────────────────────────────┤
│ PARTNERS     E-wallet / payment gateway · SMS / WhatsApp     │
├──────────────────────────────────────────────────────────────┤
│ 3D PIPELINE  Scan → model → seats → views → hall package     │
│ (offline)    uploaded through the back office                │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Technology

| Layer | Choice | Why |
|---|---|---|
| Web app | React 19, TypeScript, Vite, Tailwind (right-to-left), installable PWA | Same as the demo; no app store needed |
| 3D | three.js (React Three Fiber), glTF with Meshopt + KTX2 | Fast 3D in mobile browsers, small files |
| API | Node.js, Express 5, Zod validation | Same as the demo; one language end to end |
| Database | PostgreSQL (replaces the demo's SQLite) | Many users at once, backups, point-in-time recovery |
| Live seats | Server-Sent Events, plus PostgreSQL LISTEN/NOTIFY when there are 2+ app servers | Already built; no extra message broker |
| Hall files | Static files on Nginx with long-term caching | Hall packages are versioned and never change |
| Hosting | 2 Linux servers (app + database), Docker, GitHub Actions CI/CD | Simple, low cost, easy to move |
| Monitoring | Error tracking, uptime alerts, daily off-site backups (self-hostable tools) | We find problems before customers do |

### 7.3 Key decisions
1. **Build on the demo, don't restart.** The hall model, seat-hold logic, 3D scene and most screens already work.
2. **One hall model drives everything.** Seat map, 3D scene, view score, validation and prices all come from `hall.json`, so they never disagree.
3. **Scan the room, model the seat once.** Seats are one accurate model placed at the surveyed positions. That keeps downloads small, and each seat can still show free / held / sold.
4. **Made for Syrian networks and phones.** Small first load, offline tickets, low-data mode, and no dependence on services that are blocked or slow in Syria (fonts and libraries are self-hosted, as in the demo).
5. **The database guarantees no double booking**, not just the code.
6. **One seat inventory.** Website, box office and phone bookings all go through the same API.
7. **Simple to run.** One backend on two servers: no microservices, no Kubernetes.

### 7.4 Quality targets

| Area | Target |
|---|---|
| Speed on 4G | Showtime page < 2 s · seat-view photo < 1 s · 3D hall usable < 3 s |
| Peak load | 500 people booking at the same time (premiere night), tested at 2× |
| No double booking | 200 users try to book the same seat at once → exactly 1 succeeds |
| Availability | 99.5% per month |
| Devices | Android 10+ and iOS 15+; older phones get seat-view photos |
| Security | OWASP Top 10, HTTPS, two-factor login for staff, no card data stored, daily encrypted backups |
| Languages | Arabic (right-to-left) and English |

---

## 8. Database design

PostgreSQL. It extends the demo's schema (`server/db.ts`): same rules, more tables.

### 8.1 Relationships

```
cinemas ──< halls ──< hall_versions ──< seats
halls ──< showtimes >── movies
showtimes ──< prices
showtimes ──< holds
customers ──< bookings >── showtimes
bookings ──< booking_seats >── seats
bookings ──< payments
staff_users ──< audit_log

A ──< B  means: one A has many B
```

### 8.2 Main tables

| Table | Key columns | Notes |
|---|---|---|
| `cinemas` | id, name (ar/en), city, time_zone | Ready for more branches |
| `halls` | id, cinema_id, name, kind, active_version_id | Hall 1, Hall 2, a future VIP hall |
| `hall_versions` | id, hall_id, version, package_url, screen, scanned_at, accuracy_mm, status | A new version after each re-scan |
| `seats` | hall_version_id, seat_id ("F12"), row, number, type, position, eye_point, view_score, accessible | One row per real seat |
| `movies` | id, title (ar/en), duration, rating, formats, poster, trailer, status | |
| `showtimes` | id, movie_id, hall_id, hall_version_id, starts_at, ends_at, format, status | Fixed to one hall version |
| `prices` | showtime_id, seat_type, amount | Price per seat type, in SYP |
| `holds` | showtime_id, seat_id, owner, expires_at | Seats in someone's basket (10 minutes) |
| `customers` | id, phone (unique), name, language | Login = phone + one-time code |
| `bookings` | code ("CC-7K4M2Q"), showtime_id, customer_id, channel, status, payment_status, total | Channel: web, box office, phone |
| `booking_seats` | booking_code, showtime_id, seat_id, seat_type, price, active | One row per booked seat |
| `payments` | id, booking_code, provider, provider_ref, amount, status, raw_data | Every attempt and callback |
| `staff_users` | id, name, role, password_hash, two_factor, active | Roles: admin, manager, cashier, usher |
| `audit_log` | at, staff_id, action, entity, details | Who changed what, and when |

### 8.3 Rules built into the database
- **No double booking:** a unique index on `booking_seats (showtime_id, seat_id)` for active rows. This is already in the demo.
- **One hold per seat:** the key of `holds` is `(showtime_id, seat_id)`. An expired hold counts as free.
- **Statuses:** booking `pending_payment → confirmed → checked_in`, or `expired` / `cancelled`. Payment `due → paid → refunded`.
- **Money and time:** whole Syrian pounds stored as integers. Times stored in UTC, shown in Damascus time (UTC+3).
- **Versioned halls:** a re-scan adds a new hall version, and old tickets still point to the seats they sold.

---

## 9. Booking APIs

### 9.1 Rules
- REST + JSON over HTTPS, versioned under `/api/v1`, documented in OpenAPI (`docs/openapi.yaml`, already started).
- Seats can be held before login (anonymous browser session, as in the demo). Checkout needs a phone login with a one-time code.
- Staff use personal accounts with roles and two-factor login. This replaces the demo PIN.
- An `Idempotency-Key` header on bookings and payments means a retry on a weak connection never books or charges twice.
- Prices are always calculated by the server. Up to 8 seats per booking. Rate limits on codes, holds and logins.
- Payment callbacks are signature-checked. Card and wallet details never reach our servers.
- One error format: `{ "error": { "code", "message", "details" } }`.

### 9.2 Endpoints

All paths start with `/api/v1`.

| Endpoint | Purpose | Status |
|---|---|---|
| **Catalogue and halls** | | |
| `GET /movies` · `GET /movies/{id}` | Films and their 7-day schedule | In demo |
| `GET /halls` | List of halls | In demo |
| `GET /halls/{id}/package` | Current hall version: `hall.json` and file links | New |
| `GET /halls/{id}/seats/{seatId}/view` | Seat-view photo, screen corners, view score | New |
| **Seats** | | |
| `GET /showtimes/{id}` | Showtime, hall and taken seats | In demo |
| `GET /showtimes/{id}/events` | Live seat changes (Server-Sent Events) | In demo |
| `POST /showtimes/{id}/holds` | Hold a seat for 10 minutes | In demo |
| `DELETE /showtimes/{id}/holds[/{seatId}]` | Release one seat, or all | In demo |
| **Customers** | | |
| `POST /auth/otp` · `POST /auth/verify` | Send and check the login code | New |
| `POST /bookings` | Book the held seats (all or nothing) | In demo |
| `POST /bookings/{code}/pay` | Start payment → provider link or instructions | New |
| `GET /bookings` · `GET /bookings/{code}` | My bookings · one booking with its QR | In demo |
| `POST /bookings/{code}/cancel` | Cancel before the show, per policy | In demo |
| **Payment providers** | | |
| `POST /payments/{provider}/webhook` | Signed payment confirmation | New |
| **Staff** | | |
| `POST /staff/login` | Account login with two-factor code | New |
| `/admin/movies` · `/admin/showtimes` · `/admin/prices` | Create, edit and remove the programme and prices | New |
| `POST /admin/halls/{id}/versions` · `…/{version}/publish` | Upload and publish a hall package | New |
| `POST /admin/sales` | Box-office sale (cash) | New |
| `POST /admin/bookings/{code}/check-in` | Admit at the door (QR scan) | In demo |
| `GET /admin/overview` | Today's dashboard | In demo |
| `GET /admin/reports/{type}` | Sales, occupancy, seat-view usage | New |

The demo-only endpoints (`/admin/login` with a PIN, `/admin/reset`) are removed.

### 9.3 Booking flow
1. The app loads the hall package (cached on the phone) and the live seat map.
2. The customer taps a seat. It is held for 10 minutes and turns amber for everyone else within a second.
3. They sit in the seat (3D or photo), compare seats and add more (up to 8).
4. Checkout: phone number + one-time code.
5. `POST /bookings` locks the seats, then `POST /bookings/{code}/pay` opens the e-wallet / gateway, or the customer picks "pay at box office".
6. The provider confirms by webhook. The booking is confirmed and the QR e-ticket goes out by SMS/WhatsApp and in the app.
7. At the door, the usher scans the QR and the booking is checked in. Unpaid bookings and lapsed holds free their seats automatically.

### 9.4 Examples

**Hold a seat**

```http
POST /api/v1/showtimes/st-20261201-hall-1-2015/holds
X-Session-Id: 9f2c4e7a1b3d4c5e
Content-Type: application/json

{ "seatId": "H15" }
```

```json
{
  "seatId": "H15",
  "seatIds": ["H14", "H15"],
  "holdExpiresAt": "2026-12-01T17:25:00Z",
  "serverTime": "2026-12-01T17:15:00Z"
}
```

If someone else got there first, the answer is `409 Conflict`:

```json
{ "error": { "code": "SEAT_UNAVAILABLE", "message": "Seat H15 is not available", "details": { "seatIds": ["H15"] } } }
```

**View from a seat** (values computed from the demo's Hall 1 model)

```http
GET /api/v1/halls/hall-1/seats/H15/view
```

```json
{
  "seatId": "H15",
  "hallVersion": 2,
  "image": "/halls/hall-1/v2/views/H15.webp",
  "imageSize": [1600, 900],
  "screenCorners": [[473, 312], [1177, 289], [1178, 610], [471, 591]],
  "eye": [2.52, 3.43, 14.23],
  "view": {
    "score": 97, "rating": "excellent",
    "screenAngle": 43.3, "offAxis": 10, "tilt": 0.8,
    "distanceM": 14.45, "clearanceCm": 16
  }
}
```

---

## 10. Development phases and team

| Phase | Weeks | Main work | Milestone |
|---|---|---|---|
| 0. Discovery | 1–2 | Confirm halls, seat plans, providers and policies; UX updates; scan plan | Scope signed off |
| 1. Scanning and digital twins | 2–7 | Scan both halls (2 mornings), process the scans, survey the seats, build the hall packages | Hall 1 accepted (week 5), Hall 2 (week 7) |
| 2. Realistic seat view | 4–12 | Scanned halls in the 3D viewer, real seat model, lighting, film on screen, seat-view photos, low-data mode | Views match the reference photos |
| 3. Booking platform and APIs | 3–12 | PostgreSQL, phone login, payments, SMS/WhatsApp, staff accounts, back-office APIs, servers | API complete on the test server |
| 4. Apps | 5–15 | Customer PWA, back office, box-office mode, door scanner, reports | Beta ready |
| 5. Testing and acceptance | 13–17 | Functional, load and race tests, security test, staff training, user acceptance | Sign-off |
| 6. Launch and support | 18–22 | Go-live, close monitoring, fixes, handover | Live and handed over |

```
Week                    1   5    10   15   20
0 Discovery             ██
1 Scanning & twins       ██████
2 Realistic seat view      █████████
3 Booking platform        ██████████
4 Apps                      ███████████
5 Testing & acceptance              █████
6 Launch & support                       █████
                                         ▲ go-live
```

**Team**

| Role | Time on the project |
|---|---|
| Project manager / business analyst | 40%, weeks 1–22 |
| Tech lead (full-stack) | Full time in weeks 1–18, part time during support |
| Backend developer | Weeks 3–17 |
| Frontend developer | Weeks 4–17 |
| 3D / WebGL developer | Weeks 2–14 |
| 3D scanning technician / 3D artist | Weeks 2–8 |
| UI/UX designer | Weeks 1–10 (part time after week 3) |
| QA engineer | Weeks 8–18 |
| DevOps engineer | 20%, weeks 1–22 |

---

## 11. Estimated costs

### 11.1 One-off cost (2 halls, 460 seats)

| Item | Effort | USD |
|---|---|---|
| 0. Discovery and design | 1.0 pm | 2,500 |
| 1. Scanning and digital twins | 2.5 pm | 6,250 |
| 2. Realistic seat view | 3.0 pm | 7,500 |
| 3. Booking platform and APIs (incl. DevOps) | 5.5 pm | 13,750 |
| 4. Apps: customer, back office, box office, scanner | 4.5 pm | 11,250 |
| 5. Testing and acceptance | 2.5 pm | 6,250 |
| 6. Launch and 4 weeks of support | 1.0 pm | 2,500 |
| Project management | 2.0 pm | 5,000 |
| **Labour subtotal** | **22 pm** | **55,000** |
| Scanner rental, 1 week incl. shipping and insurance | | 3,000 |
| Camera and survey kit | | 3,500 |
| Workstation, UPS and backup drives | | 4,500 |
| Software licences, year 1 | | 2,000 |
| Test phones (low/mid-range Android, iPhone) | | 1,000 |
| **Equipment and software subtotal** | | **14,000** |
| Contingency (10%) | | 6,900 |
| **Total** | | **≈ 75,900** |

pm = person-month. Likely range: $65,000–87,000 (±15%).

**Ways to change the budget**
- The team already owns a camera kit and a workstation: **about −$8,000**.
- Each extra hall, scanned in the same visit (for example a VIP lounge): **about +$2,000**.
- Buying the scanner instead of renting it: **about +$17,000**. Only worth it for several venues.

### 11.2 Running costs (monthly)

| Item | USD per month |
|---|---|
| Hosting: 2 servers, backups, monitoring | 80–250 |
| SMS / WhatsApp (about 2 messages per booking) | Pay per message |
| Payment fees | Per provider contract |
| Support and maintenance plan (optional): fixes, updates, security patches, small changes | 600–1,000 |

### 11.3 Suggested payment milestones
30% at signing · 30% when both hall models are accepted (week 7) · 30% at sign-off (week 17) · 10% after the support period (week 22).

---

## 12. Project deliverables

| # | Deliverable | Format |
|---|---|---|
| 1 | Digital twin of each hall: point cloud, panoramas, floor plan and section | E57, JPG, PDF/DXF |
| 2 | Hall packages: web 3D room, seat model, surveyed seat and screen data | GLB, JSON |
| 3 | The view from all 460 seats: image and view score | WebP, JSON |
| 4 | Accuracy and validation report for each hall | PDF |
| 5 | Customer web app (PWA), Arabic and English | Live website + source |
| 6 | Booking API with documentation | Live API + OpenAPI file |
| 7 | Back office, box-office mode and door scanner | Live + source |
| 8 | Payment and SMS/WhatsApp integrations | Live |
| 9 | Servers, CI/CD, backups and monitoring | Scripts + runbook |
| 10 | Test reports: functional, load/race, security | PDF |
| 11 | Guides and training: staff, admin, "how to re-scan a hall" | PDF + sessions |
| 12 | Full source code | Git repository |

**Acceptance criteria for the core goal**
- 100% of the seats in every hall have an eye point, a seat-view photo and a score.
- At 5 reference seats per hall, the screen edges in the simulation match the real photo to within 2% of the screen width.
- Seat labels match the seats in the hall and the box-office plan (signed off by the cinema).
- The seat view opens in under 1 second on 4G on the agreed test phones.

---

## 13. Risks and mitigation

| Risk | Mitigation |
|---|---|
| Power cuts and unstable internet at the cinema | Servers hosted off-site; UPS and 4G backup at the box office; tickets and the door scanner work offline |
| Few online payment options in Syria | Plug-in payment adapters; launch with "pay at box office" plus at least one e-wallet; add more later |
| Services that are blocked or slow in Syria | Self-host fonts and libraries (as in the demo); choose hosting that Syrian networks reach well; test from local providers before launch |
| Getting a scanner into the country | Start the rental/import early (allow 2–4 weeks), or hire a regional scanning company |
| Dark or shiny surfaces scan badly (black walls, silver screen) | Full lights, extra scan positions, screen corners measured with the laser meter |
| Older phones and costly mobile data | Small first load, caching on the phone, low-data mode |
| Seat numbers on site differ from the plans | Seat-by-seat check during the scan; layout signed off by the cinema |
| A renovation changes the seats | Versioned hall packages; re-scanning one hall costs about $2,000 |

---

## 14. Next steps
1. Review this proposal and confirm the assumptions: halls, seats, providers, policies.
2. Agree dates for a site visit and two scanning mornings.
3. Optional pilot: scan Hall 2 and show its real seat views in the demo. About 3 weeks and $5,000, which can be credited to the full project.
4. Sign off the scope and start Phase 0.
