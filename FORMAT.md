# The board file format

A board is one self-contained JSON document. The file you get from
*Settings → Export board* (or by pointing a board at a file on disk) is the
**complete** board: items, comments, deliverables, questions, settings, banner
image and all. There is no sidecar, no partial export, and nothing held back.
Import it anywhere and you have everything.

This document exists so you can verify that claim, repair a damaged file by
hand, or write your own tooling against the format. The authoritative
definitions live in [`lib/types.ts`](./lib/types.ts) (shapes) and
[`lib/schema.ts`](./lib/schema.ts) (validation); this page is the readable tour.

## Top level

```jsonc
{
  "kind": "worktracker.board",   // rejected on import if it is anything else
  "schemaVersion": 1,
  "id": "a-uuid",
  "name": "My board",
  "createdAt": "2026-07-17T09:00:00.000Z",
  "updatedAt": "2026-07-17T09:05:00.000Z", // bumped by every mutation
  "settings": { … },
  "items": [ … ],
  "deliverables": [ … ]
}
```

All timestamps are ISO 8601 strings. All ids are UUIDs; they only need to be
unique within the document.

### Versioning policy

- A file with an **older** `schemaVersion` is migrated forward on load, one
  version at a time.
- A file with a **newer** `schemaVersion` than the app understands is
  **refused**, never downgraded — a newer file may contain data this version
  would silently drop, and losing data on open is the one unforgivable bug in
  a local-first tool.
- New optional fields are added with defaults instead of version bumps where
  possible (`archivedAt` was added this way), so old files keep parsing.

## `settings`

```jsonc
{
  "clientName": null,        // string | null — subtitle shown under the board name
  "phase": null,             // string | null — free-text phase label
  "bannerUrl": null,         // string | null — see the banner note below
  "accent": "linear-gradient(135deg, …)" // string | null — CSS background-image for the banner
}
```

**Banner note:** a custom banner image is stored *inside* the document as a
`data:` URI in `bannerUrl`, so it travels with exports and renders offline.
Remote (`https:`) banner URLs are deliberately **never rendered** — a remote
image in an imported board would be a network beacon that fires the moment the
board opens, and this app's whole contract is that opening a board touches no
network.

## `items[]` — the kanban cards

```jsonc
{
  "id": "…",
  "title": "Fix invoice rounding",
  "description": null,       // string | null — rendered as markdown in the app
  "category": "bug",         // data_needed | question | decision | task | bug | feature
  "priority": "high",        // high | medium | low
  "status": "in_progress",   // pending | in_progress | done | blocked | future_phase
  "assignedTo": null,        // string | null — vestigial, always null; no assignment UI
  "dueDate": null,           // "YYYY-MM-DD" | null
  "completedAt": null,       // derived — see below
  "archivedAt": null,        // derived — see below
  "sortOrder": 10,           // ordering within a status column
  "createdAt": "…",
  "updatedAt": "…",
  "notes": [
    { "id": "…", "content": "a comment", "createdAt": "…" }
  ]
}
```

### Derived fields (the store owns these — tools should not invent them)

- `completedAt` is stamped when an item transitions **to** `done` and nulled
  when it transitions to anything else. It is never edited directly.
- `archivedAt` set = the item is in the archive, off the board. `status` is
  untouched by archiving, so a restored item lands back in the column it left.
- On deliverable questions, `answeredAt` is stamped when an answer is first
  set and cleared when the answer is cleared (which also reopens the question).

Hand-editing these in a file is harmless — the app treats the file as truth —
but tools that *write* the format should follow the same rules or "completed
this week" style counts will quietly lie.

## `deliverables[]` — the "show the work" panel

```jsonc
{
  "id": "…",
  "tab": "ongoing",          // backlog | ongoing | delivered  (never "questions" — that tab is computed)
  "itemNumber": "07",        // string | null — display label, not an identifier
  "title": "Checkout flow",
  "subtitle": null,          // string | null
  "scopeMd": null,           // string | null — markdown
  "guideMd": null,           // string | null — markdown
  "buildNotesMd": null,      // string | null — markdown
  "status": "active",        // pending | active | blocked | delivered | live | future
  "sortOrder": 10,
  "createdAt": "…",
  "updatedAt": "…",
  "questions": [
    {
      "id": "…",
      "questionMd": "Which tax table?",  // markdown
      "answerMd": null,                  // string | null — markdown
      "answeredAt": null,                // derived, see above
      "category": null,                  // string | null — free-text grouping
      "status": "open",                  // open | answered | dismissed
      "sortOrder": 10,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

## Where validation happens

Exactly two boundaries run the zod schema: loading a persisted board and
importing a user-supplied file. A file that fails validation is rejected with
a reason — the app never "repairs" your data by guessing. One deliberate
exception: a banner image over the size cap (~900k characters of `data:` URI)
is dropped so the rest of the board still loads — losing a wallpaper beats
losing a board. Everything else after those boundaries trusts the document.

Markdown fields are parsed by [`lib/markdown.ts`](./lib/markdown.ts), which
emits a data tree rather than HTML — script tags, event handlers and
`javascript:` links in a hostile file render as inert text. Boards are
imported from untrusted places; the renderer is built for that.

## Verifying the network promise

You don't have to take "nothing is sent anywhere" on faith:

1. The page carries a `Content-Security-Policy` `<meta>` tag of
   `connect-src 'none'`: your **browser** enforces that no fetch, XHR or
   WebSocket can ever leave this page — it is not an honor system. The hosted
   deployment's response headers additionally restrict images, fonts, media
   and frames to the app itself.
2. Open devtools → Network, use the app, and watch nothing appear after load.
3. Disconnect from the internet. Everything keeps working, including export.
