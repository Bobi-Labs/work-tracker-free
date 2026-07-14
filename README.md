# Bobi Tracker

A kanban board that runs entirely in your browser. **No account, no server, no tracking.**
Your work never leaves your machine.

[**Try it →**](https://bobi-labs.github.io/work-tracker-free/) &nbsp;·&nbsp; MIT licensed &nbsp;·&nbsp; Zero backend

---

## Why

Most task trackers want an account before they'll show you a board, then keep your
data on someone else's computer. This one doesn't. There is no sign-up because there
is nothing to sign up *to* — the app is a static site, and your board is a file.

## What it does

- **Kanban board** — five columns, drag-and-drop, quick-done, keyboard-accessible dragging.
- **List view** — sortable table, multi-select, bulk status changes.
- **Item detail** — description, priority, category, assignee, due date, and comments.
- **Deliverables** — the scope, guide, build notes and open questions behind each piece
  of work. Answer a question and it's marked answered and dated; clear the answer and
  it reopens.
- **Filters** — status, priority, category, due date (overdue / today / this week / no date), and assignee.
- **Unlimited boards.** No cap, and there never will be one.
- **Light and dark themes.**
- **Save to a real file** — on Chrome and Edge, point a board at a `.json` file on your
  disk and every change is written to it *and* to browser storage. Keep it in a synced
  folder, a repo, anywhere you already back things up. (Firefox and Safari don't support
  this yet — those browsers use browser storage plus export/import.)
- **Export / import** — your whole board as a single `.json` file, anywhere.

## Where your data lives

In **this browser, on this device**, in `localStorage`. That has one important
consequence, and we'd rather say it plainly than bury it:

> **Clearing your browser's site data will erase your boards.**

So:

- **Export regularly.** Settings → *Export board*. It's one self-contained `.json` file.
- Import it back on any machine, in any browser. It's yours, it's plain text, and it's
  readable without this app.

Nothing is ever sent anywhere. There is no network call in this application — not for
analytics, not for fonts, not for anything. You can verify that: unplug from the
internet and it keeps working.

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Build a static site (no server needed — the output is plain files):

```bash
pnpm build      # emits ./out
npx serve out
```

Other scripts:

```bash
pnpm typecheck
pnpm test
```

### Hosting it somewhere

`./out` is the whole application. Drop it on any static host, open `index.html`
from `file://`, or serve it from a USB stick — it doesn't care.

One caveat: if you serve it from a **sub-path** rather than a domain root (GitHub
Pages project sites do this, and so does any reverse-proxy mount), set `BASE_PATH`
at build time or every asset will 404:

```bash
BASE_PATH=/my-subpath pnpm build
```

Leave it unset for a domain root, `file://`, or a desktop build — those need *no*
base path, and setting one breaks them. It's the only environment variable in the
project, and it's optional.

## Tech

Next.js (static export) · React · TypeScript · Tailwind · zod ·
[@hello-pangea/dnd](https://github.com/hello-pangea/dnd)

Persistence sits behind a deliberately dumb `StorageAdapter`
(`load` / `save` / `clear`, whole-document). That's what lets the same store back
`localStorage` today, the File System Access API next, and a desktop build after that,
without the UI knowing which one it's talking to.

## Roadmap

- **Desktop app** — a Tauri build, with local files natively. The storage layer is
  already shaped for it: the same `StorageAdapter` that backs browser storage and the
  File System Access API takes a native file handle without the UI knowing.

## Need something more?

This is the free tool, and it stays free. If you need a version built around *your*
workflow — multiple users, client-facing views, invoicing, Telegram or Drive
integration, a hosted deployment — that's what [Bobi Labs](https://bobilabs.dev) does.

## License

MIT. See [LICENSE](./LICENSE). Use it, fork it, sell it, ship it.
