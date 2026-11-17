# Cinema City Syria — working notes

Online booking demo for Cinema City, Damascus: React + three.js client (`src/`), Express + SQLite
server (`server/`), shared rules and types (`shared/`). The README explains the product; this file
holds the rules for working on it.

## Finished work goes into master

When a task is done — `npm test` passes, `npm run typecheck` is clean, and anything visible has been
tried in the running app — merge it into `master` before ending, so `master` always holds the latest
finished work:

1. Do the work on its own branch (`claude/<topic>`), never directly on `master`.
2. Commit there, then `git switch master` and `git merge --no-ff <branch>` (a merge commit, like the
   existing history).
3. Run `npm test` on `master` once more, then delete the merged branch (`git branch -d <branch>`).
4. Never leave finished work only on a side branch or in a worktree. Unfinished work stays on its
   branch, and say so.

Pushing `master` to GitHub (`origin`) is a separate step: ask first.

## Films

- Only real films, with facts checked against the studios' or cinema chains' published details —
  never invented titles, people or synopses presented as real.
- The programme is `server/data/catalog.ts`, which hall plays what is `server/data/schedule.ts`;
  after changing them run `npm run db:reset`. A film's status follows its release date;
  `advanceBookingFrom` opens its opening week for booking early.
- Tests run on the fictional films in `server/fixtures/films.ts`, so they never depend on the
  real programme.

## Commands

- `npm run dev` — web app on http://localhost:5173 with the API on 4000; `npm run demo` — production
  build served on http://localhost:4000. Staff page `/staff`, PIN 1234.
- `npm test`, `npm run typecheck`, `npm run build`.
