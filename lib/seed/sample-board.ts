/**
 * The sample board — "Load sample board" on the empty state.
 *
 * Harvested from the private app's demo seed (`scripts/seed-demo.mjs`, since
 * deleted), which described a fictional SaaS company, Acme Inc., and its
 * customer portal. The content was already brand-neutral, which is the only
 * reason it survived the cut: it is the only realistic dataset that ever
 * existed in this codebase, and writing a convincing one from scratch is
 * harder than it looks.
 *
 * Three things changed in the port:
 *
 * 1. **The three remote banner URLs are gone.** They pointed at a stock-photo
 *    CDN. A remote image is a broken image the moment this build is opened
 *    offline, off a `file://` path, or inside Tauri — which is most of the ways
 *    it will actually be opened. `settings.accent` carries a CSS gradient
 *    instead: no network, no 404.
 * 2. **Everything invoice-shaped is gone** — amounts, invoice numbers, paid/sent
 *    stamps, line items — along with the deliverable "updates" feed and the
 *    discovery plans. The good prose from the discovery plans was folded into
 *    `buildNotesMd`, which is where it belonged anyway.
 * 3. **Due dates are computed, not literal.** The seed hard-coded dates in
 *    May 2026. Frozen dates rot: ship a sample board with a wall of overdue-red
 *    cards and the tool looks broken on first run. Dates here are offsets from
 *    *today*, so the board is always plausibly live — including exactly one
 *    deliberately overdue item, because a sample board that never shows the
 *    overdue state fails to demo it.
 *
 * The old seed also scattered notes across items at random (`Math.random() <
 * 0.5`). Here they are hand-placed on the items they actually comment on. A
 * demo should not be a coin flip.
 */

import { newId } from "../id";
import type {
  BoardDoc,
  Deliverable,
  DeliverableStatus,
  Item,
  ItemCategory,
  ItemPriority,
  ItemStatus,
  Note,
  Question,
  QuestionStatus,
} from "../types";
import { DOC_KIND, SCHEMA_VERSION } from "../types";

/* ─────────────────────────────── Time ─────────────────────────────── */

const DAY_MS = 86_400_000;

/** Full ISO timestamp, `d` days before `now`. */
const at = (now: number, daysAgo: number): string =>
  new Date(now - daysAgo * DAY_MS).toISOString();

/** `YYYY-MM-DD`, `d` days after `now`. Negative `d` is in the past (overdue). */
const due = (now: number, inDays: number): string =>
  new Date(now + inDays * DAY_MS).toISOString().slice(0, 10);

/* ─────────────────────────────── Specs ───────────────────────────────
 * Plain descriptions of the content, with time expressed in days relative to
 * the moment `createSampleBoard()` is called. The builders below turn these
 * into real rows — minting ids, resolving timestamps, and deriving the fields
 * the store owns (`sortOrder`, `completedAt`) rather than trusting a literal to
 * get them right.
 */

interface NoteSpec {
  content: string;
  daysAgo: number;
}

interface ItemSpec {
  title: string;
  description: string;
  category: ItemCategory;
  priority: ItemPriority;
  status: ItemStatus;
  assignedTo: string;
  /** Days from today. Negative is overdue. Omit for no due date. */
  dueInDays?: number;
  /** How long ago the item was created. */
  agedDays: number;
  /** Only meaningful when `status` is `"done"`; ignored otherwise. */
  completedDaysAgo?: number;
  notes?: NoteSpec[];
}

interface QuestionSpec {
  questionMd: string;
  answerMd?: string;
  status: QuestionStatus;
  category?: string;
  askedDaysAgo: number;
  answeredDaysAgo?: number;
}

interface DeliverableSpec {
  tab: Deliverable["tab"];
  itemNumber: string | null;
  title: string;
  subtitle?: string;
  status: DeliverableStatus;
  scopeMd?: string;
  guideMd?: string;
  buildNotesMd?: string;
  agedDays: number;
  touchedDaysAgo: number;
  questions?: QuestionSpec[];
}

/* ─────────────────────────────── Items ─────────────────────────────── */

const ITEM_SPECS: ItemSpec[] = [
  /* — Pending — */
  {
    title: "Stripe webhook for failed-payment retry flow",
    description:
      "Capture invoice.payment_failed, queue 3-attempt retry over 14 days with backoff. Email customer on each attempt.",
    category: "feature",
    priority: "high",
    status: "pending",
    assignedTo: "Alex",
    dueInDays: 5,
    agedDays: 9,
  },
  {
    title: "Choose monitoring tool — Sentry vs Datadog",
    description:
      "Sentry covers errors well, Datadog adds full APM but costs 3x. Decision before Q3 budget locks.",
    category: "decision",
    priority: "medium",
    status: "pending",
    assignedTo: "Sam",
    dueInDays: 2,
    agedDays: 12,
    notes: [
      {
        content:
          "Sentry-leaning given the cost. I'll write up the APM trade-offs before standup so we can close this out.",
        daysAgo: 1,
      },
    ],
  },
  {
    title: "Get tax-jurisdiction data from accounting",
    description:
      "Need the finalized list of states + countries we collect tax in before the new checkout flow can ship.",
    category: "data_needed",
    priority: "high",
    status: "pending",
    assignedTo: "Jordan",
    dueInDays: -2,
    agedDays: 16,
    notes: [
      {
        content:
          "Accounting has the country list ready, but the US state list is still being reconciled. Chasing — this is the last blocker on checkout.",
        daysAgo: 2,
      },
    ],
  },
  {
    title: "Customer success: which Pro-tier features do enterprise need?",
    description:
      "CS is fielding 'is this in Pro?' questions daily. Want a definitive matrix before we publish pricing.",
    category: "question",
    priority: "medium",
    status: "pending",
    assignedTo: "Sam",
    agedDays: 6,
  },

  /* — In Progress — */
  {
    title: "Multi-org switcher in nav",
    description:
      "Power users belong to multiple orgs. Needs a clean dropdown switcher with per-org context preserved across navigation.",
    category: "feature",
    priority: "high",
    status: "in_progress",
    assignedTo: "Alex",
    dueInDays: 9,
    agedDays: 21,
    notes: [
      {
        content:
          "Pushed a draft branch — `feat/multi-org-switcher`. Feedback before I open the PR?",
        daysAgo: 4,
      },
      {
        content:
          "Heads up: I rewrote the context provider too. Worth a careful look at the cache-key edge case in `OrgContext` — that's where the bodies are buried.",
        daysAgo: 3,
      },
    ],
  },
  {
    title: "Onboarding email goes to spam in Outlook",
    description:
      "SPF + DKIM both pass, DMARC quarantine. Suspect the content is triggering it — there's a 'click here' button. Trying a plain-text variant.",
    category: "bug",
    priority: "medium",
    status: "in_progress",
    assignedTo: "Jordan",
    agedDays: 14,
    notes: [
      {
        content:
          "Plain-text variant is out to 10% of new signups. Outlook placement looks better already; giving it a week of data before we roll it to everyone.",
        daysAgo: 2,
      },
    ],
  },
  {
    title: "Audit + clean up unused Postgres indexes",
    description:
      "pg_stat_user_indexes shows 12 indexes with idx_scan=0. Confirming none are needed for FK constraint enforcement before dropping them.",
    category: "task",
    priority: "low",
    status: "in_progress",
    assignedTo: "Alex",
    agedDays: 8,
    notes: [
      {
        content:
          "Looking at the schema again — we may want a composite index here rather than the two singles. Will benchmark before I drop anything.",
        daysAgo: 3,
      },
    ],
  },

  /* — Blocked — */
  {
    title: "Migrate logs from CloudWatch to Loki",
    description:
      "Waiting on the infra team to provision the Loki cluster. Estimated unblock: end of week.",
    category: "task",
    priority: "medium",
    status: "blocked",
    assignedTo: "Sam",
    agedDays: 19,
  },
  {
    title: "SSO via Google Workspace",
    description:
      "Enterprise customer asked for it. Blocked on legal review of the OAuth scope list — they want our DPA updated first.",
    category: "feature",
    priority: "high",
    status: "blocked",
    assignedTo: "Jordan",
    dueInDays: 12,
    agedDays: 24,
    notes: [
      {
        content:
          "Confirmed with legal — the DPA update lands Tuesday. That should unblock this by Wednesday.",
        daysAgo: 1,
      },
    ],
  },

  /* — Done — */
  {
    title: "Dark mode in dashboard",
    description:
      "Tailwind dark: variants applied across all components. Toggle persisted in localStorage.",
    category: "feature",
    priority: "low",
    status: "done",
    assignedTo: "Alex",
    agedDays: 27,
    completedDaysAgo: 6,
  },
  {
    title: "Race condition in webhook deduplication",
    description:
      "Two workers occasionally processed the same Stripe event. Fixed with a unique constraint on event_id + ON CONFLICT DO NOTHING.",
    category: "bug",
    priority: "high",
    status: "done",
    assignedTo: "Alex",
    agedDays: 18,
    completedDaysAgo: 4,
  },
  {
    title: "Write Playwright e2e tests for signup flow",
    description: "5 happy paths + 3 error states. Running nightly in CI.",
    category: "task",
    priority: "medium",
    status: "done",
    assignedTo: "Sam",
    agedDays: 22,
    completedDaysAgo: 3,
  },
  {
    title: "Audit log viewer for admin",
    description:
      "Read-only table showing every admin action over the last 90 days, filterable by actor + action type.",
    category: "feature",
    priority: "medium",
    status: "done",
    assignedTo: "Jordan",
    agedDays: 31,
    completedDaysAgo: 2,
    notes: [
      {
        content:
          "Could we expose the underlying numbers in the CSV export too? The spreadsheet folks would appreciate it.",
        daysAgo: 2,
      },
    ],
  },

  /* — Future Phase — */
  {
    title: "Mobile app (React Native)",
    description:
      "Customer feedback keeps suggesting it; revenue impact is unclear. Parked for the Phase 3 budget review.",
    category: "feature",
    priority: "low",
    status: "future_phase",
    assignedTo: "Sam",
    agedDays: 33,
  },
  {
    title: "AI summary of long support threads",
    description:
      "CS requested it. Real value, but lower priority than the feature-parity work.",
    category: "feature",
    priority: "low",
    status: "future_phase",
    assignedTo: "Jordan",
    agedDays: 29,
  },
];

/* ──────────────────────────── Deliverables ──────────────────────────── */

const DELIVERABLE_SPECS: DeliverableSpec[] = [
  {
    tab: "delivered",
    itemNumber: "01",
    title: "Customer onboarding redesign",
    subtitle: "Phase 1 scope · shipped",
    status: "delivered",
    scopeMd:
      "Replaced the 5-step wizard with a single-page form plus progressive disclosure. " +
      "Time-to-first-action dropped from a 4m20s median to 1m40s. Mobile-friendly down to 320px. " +
      "Email confirmation switched to a plain-text variant for deliverability. Tracked end-to-end " +
      "as a funnel.",
    guideMd:
      "Visit `/onboard` for the new flow.\n\n" +
      "Power-user shortcuts — skipping steps when every required field is already filled — live under " +
      "**Settings → Onboarding**.",
    agedDays: 61,
    touchedDaysAgo: 12,
  },
  {
    tab: "delivered",
    itemNumber: "02",
    title: "Audit log viewer",
    subtitle: "admin compliance surface",
    status: "delivered",
    scopeMd:
      "Read-only admin page at `/admin/audit`. Filterable by actor, action type, and date range. " +
      "Exports to CSV. Last 90 days retained hot; older rows archived weekly.",
    // The old seed carried this as a separate `discovery_plan_md` column. That
    // column did not survive the cut, but the reasoning in it is the single
    // best "show the work" artifact in the dataset — so it lives here now.
    buildNotesMd:
      "## Sources audited\n" +
      "Cloud provider admin-role events, a Postgres trigger-based audit log, and the payment webhook log. " +
      "Settled on the Postgres trigger as the canonical source — it captures who/what/when at the row level " +
      "without relying on the app to *remember* to log.\n\n" +
      "## Retention model\n" +
      "90 days hot in the live `audit_events` table. A daily job archives anything older to cold storage under " +
      "a stable filename scheme. Compliance can request a thaw and get a searchable CSV within 4h.\n\n" +
      "## Out of scope\n" +
      "- Real-time anomaly alerting — error tracking already covers that; the audit log is deliberately post-hoc.\n" +
      "- Cross-org querying — every org sees only its own entries.",
    agedDays: 47,
    touchedDaysAgo: 2,
  },
  {
    tab: "ongoing",
    itemNumber: "03",
    title: "Multi-org switcher",
    status: "active",
    scopeMd:
      "A per-account org dropdown in the global nav. The current org persists across navigation, and " +
      "deep links respect the org param.",
    buildNotesMd:
      "Refactored `UserContext` into an `OrgContext` + `UserContext` stack. A few downstream selectors " +
      "needed updating — keep an eye on the dashboard query keys for cache-key drift.\n\n" +
      "**Plan**\n\n" +
      "- _Week 1 — discovery:_ audit which endpoints accept `org_id`; find the queries that need org-scoping.\n" +
      "- _Week 2 — build:_ `OrgContext` provider, switcher UI, URL param plumbing.\n" +
      "- _Week 3 — polish:_ empty state for single-org users, `cmd+shift+O` to switch.",
    agedDays: 21,
    touchedDaysAgo: 1,
    questions: [
      {
        questionMd:
          "Should switching org land you on a fresh route, or keep you on the same page?",
        answerMd:
          "Stay on the same page — we'll show a soft toast confirming the org changed.",
        status: "answered",
        askedDaysAgo: 14,
        answeredDaysAgo: 11,
      },
    ],
  },
  {
    tab: "ongoing",
    itemNumber: "04",
    title: "SSO via Google Workspace",
    status: "blocked",
    scopeMd:
      "Standard OIDC flow. Customer-side OAuth client provisioning is documented in the customer portal.",
    buildNotesMd:
      "Blocked on legal: the DPA update needs to land before we can expose the OAuth scope list to the " +
      "customer. ETA Tuesday.",
    agedDays: 24,
    touchedDaysAgo: 1,
    questions: [
      {
        questionMd:
          "The customer wants custom IdP claims for role mapping. In scope, or a follow-up?",
        status: "open",
        category: "scope",
        askedDaysAgo: 5,
      },
    ],
  },
  {
    tab: "ongoing",
    itemNumber: "05",
    title: "Stripe failed-payment retry flow",
    status: "pending",
    scopeMd:
      "When `invoice.payment_failed` fires, queue 3 retry attempts at 1d / 3d / 7d. Email the customer a " +
      "payment-update link on each. After the third failure the account enters dunning and write actions " +
      "are frozen until it's resolved.",
    agedDays: 9,
    touchedDaysAgo: 3,
    questions: [
      {
        questionMd:
          "On attempt 3, do we hard-freeze the account or just disable writes?",
        status: "open",
        askedDaysAgo: 3,
      },
    ],
  },
  {
    tab: "backlog",
    itemNumber: null,
    title: "Email-template editor with live preview",
    subtitle: "Phase 3 candidate",
    status: "future",
    scopeMd:
      "Admins edit transactional emails — welcome, password reset, receipts — in a side-by-side editor, " +
      "with a mailable preview before save and token autocomplete for `{{user.first_name}}` and friends. " +
      "Sized at roughly one dev-week. Out of scope for the current sprint.",
    agedDays: 15,
    touchedDaysAgo: 15,
  },
  {
    tab: "backlog",
    itemNumber: null,
    title: "Two-factor auth (TOTP)",
    subtitle: "security backlog",
    status: "pending",
    scopeMd:
      "Standard TOTP flow — QR code at setup, 6-digit code at login, hashed backup codes. " +
      "SMS fallback is explicitly out of scope (cost, and it's spoofable).",
    agedDays: 11,
    touchedDaysAgo: 11,
    questions: [
      {
        questionMd:
          "Do we enforce 2FA for admin roles, or leave it opt-in for everyone?",
        status: "open",
        category: "policy",
        askedDaysAgo: 7,
      },
    ],
  },
];

/* ─────────────────────────────── Builders ─────────────────────────────── */

function buildNotes(specs: NoteSpec[] | undefined, now: number): Note[] {
  return (specs ?? []).map((n) => ({
    id: newId(),
    content: n.content,
    createdAt: at(now, n.daysAgo),
  }));
}

function buildItems(now: number): Item[] {
  // sortOrder is dense *within a status column* — the same idx * 10 convention
  // the store's reorder uses, so a freshly-loaded sample board is already in
  // the shape a reorder would leave it in.
  const nextSort = new Map<ItemStatus, number>();

  return ITEM_SPECS.map((spec) => {
    const idx = nextSort.get(spec.status) ?? 0;
    nextSort.set(spec.status, idx + 1);

    const notes = buildNotes(spec.notes, now);

    // The completedAt invariant, derived rather than declared: set iff done,
    // null otherwise. A literal would let a future edit set `status: "pending"`
    // beside a stale `completedAt` and quietly poison the "completed this week"
    // count. This makes that unrepresentable.
    const completedAt =
      spec.status === "done" ? at(now, spec.completedDaysAgo ?? 3) : null;

    // Latest of: creation, completion, most recent note. (Smaller days-ago
    // means more recent, hence `min`.)
    const touchedDaysAgo = Math.min(
      spec.agedDays,
      completedAt === null ? Infinity : (spec.completedDaysAgo ?? 3),
      ...(spec.notes ?? []).map((n) => n.daysAgo),
    );

    return {
      id: newId(),
      title: spec.title,
      description: spec.description,
      category: spec.category,
      priority: spec.priority,
      status: spec.status,
      assignedTo: spec.assignedTo,
      dueDate: spec.dueInDays === undefined ? null : due(now, spec.dueInDays),
      completedAt,
      archivedAt: null,
      sortOrder: idx * 10,
      createdAt: at(now, spec.agedDays),
      updatedAt: at(now, touchedDaysAgo),
      notes,
    };
  });
}

function buildQuestions(
  specs: QuestionSpec[] | undefined,
  now: number,
): Question[] {
  return (specs ?? []).map((q, idx) => {
    // Same rule the Questions tab enforces on inline answer edits: an answer
    // implies a stamp, and no answer implies no stamp.
    const answerMd = q.answerMd ?? null;
    const answeredAt =
      answerMd === null ? null : at(now, q.answeredDaysAgo ?? q.askedDaysAgo);

    return {
      id: newId(),
      questionMd: q.questionMd,
      answerMd,
      answeredAt,
      category: q.category ?? null,
      status: q.status,
      sortOrder: idx * 10,
      createdAt: at(now, q.askedDaysAgo),
      updatedAt: at(now, q.answeredDaysAgo ?? q.askedDaysAgo),
    };
  });
}

function buildDeliverables(now: number): Deliverable[] {
  const nextSort = new Map<Deliverable["tab"], number>();

  return DELIVERABLE_SPECS.map((spec) => {
    const idx = nextSort.get(spec.tab) ?? 0;
    nextSort.set(spec.tab, idx + 1);

    return {
      id: newId(),
      tab: spec.tab,
      itemNumber: spec.itemNumber,
      title: spec.title,
      subtitle: spec.subtitle ?? null,
      scopeMd: spec.scopeMd ?? null,
      guideMd: spec.guideMd ?? null,
      buildNotesMd: spec.buildNotesMd ?? null,
      status: spec.status,
      sortOrder: idx * 10,
      createdAt: at(now, spec.agedDays),
      updatedAt: at(now, spec.touchedDaysAgo),
      questions: buildQuestions(spec.questions, now),
    };
  });
}

/* ─────────────────────────────── Entry point ─────────────────────────────── */

/**
 * A fully-populated board: 15 items across all five statuses (one deliberately
 * overdue), 7 deliverables across all three storable tabs, 3 open questions and
 * 1 answered.
 *
 * A function, not a constant. Every call mints fresh ids and re-derives every
 * timestamp against the current clock — so loading the sample twice produces two
 * genuinely independent boards rather than two documents that share item ids and
 * fight over the same rows.
 */
export function createSampleBoard(): BoardDoc {
  const now = Date.now();

  return {
    kind: DOC_KIND,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: "Acme Customer Portal",
    createdAt: at(now, 74),
    updatedAt: at(now, 1),
    settings: {
      clientName: "Acme Inc.",
      phase: "Phase 2 — Polish + Scale",
      // Deliberately null. The seed this came from pointed at a remote stock-photo
      // CDN image; that renders as a broken image the moment the app is offline.
      bannerUrl: null,
      accent:
        "linear-gradient(120deg, #6366f1 0%, #8b5cf6 45%, #0ea5e9 100%)",
    },
    items: buildItems(now),
    deliverables: buildDeliverables(now),
  };
}
