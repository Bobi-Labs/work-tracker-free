/**
 * Quick-add token parsing: `fix invoice !high #bug @sam due:fri`.
 *
 * The capture-speed feature. Tokens are parsed out of the new-item title and
 * become structured fields; everything unrecognised stays in the title
 * untouched. That last clause is a hard rule: `#launch` is somebody's real
 * hashtag and `!important` is somebody's real emphasis, so a token is only
 * consumed when it maps to a value this board actually understands. Better to
 * leave a token in the title than to silently eat a word.
 *
 * Pure functions, no DOM, no store. The form calls `parseQuickAdd` on every
 * keystroke to drive a "will set …" hint, and once more on submit for the real
 * values, so parsing must stay cheap and must never throw.
 *
 * Syntax (whitespace-delimited whole tokens, case-insensitive):
 *   !high !medium !low        priority  (also !hi !med !lo)
 *   #task #bug #feature …     category  (must match a real category key)
 *   @name                     assignee  (case preserved; last one wins)
 *   due:today due:fri due:+3  due date  (also tomorrow, ISO, M/D)
 */

import { addDays, addYears, format } from "date-fns";

import type { ItemCategory, ItemPriority } from "@/lib/types";

export interface QuickAddParse {
  /** The raw text with every consumed token removed and whitespace collapsed. */
  title: string;
  priority: ItemPriority | null;
  category: ItemCategory | null;
  assignedTo: string | null;
  /** `YYYY-MM-DD`, same shape as `Item.dueDate` and `<input type="date">`. */
  dueDate: string | null;
}

const PRIORITY_ALIASES: Record<string, ItemPriority> = {
  high: "high",
  hi: "high",
  medium: "medium",
  med: "medium",
  low: "low",
  lo: "low",
};

/**
 * Keys of `categoryLabels`, plus forgiving spellings of the one multi-word
 * category. `#data-needed` and `#dataneeded` both mean `data_needed` because
 * nobody types an underscore on purpose.
 */
const CATEGORY_ALIASES: Record<string, ItemCategory> = {
  task: "task",
  bug: "bug",
  feature: "feature",
  question: "question",
  decision: "decision",
  data_needed: "data_needed",
  dataneeded: "data_needed",
  data: "data_needed",
};

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Resolve a `due:` value against `today`. Returns null for anything it does
 * not positively recognise — an unparseable due token stays in the title,
 * where the user can see that it did not take.
 */
function parseDueValue(value: string, today: Date): string | null {
  const v = value.toLowerCase();

  if (v === "today" || v === "tod") return format(today, "yyyy-MM-dd");
  if (v === "tomorrow" || v === "tom")
    return format(addDays(today, 1), "yyyy-MM-dd");

  // Weekday = the NEXT occurrence, where today counts ("due:fri" typed on a
  // Friday means today, not a week out). Same convention as Todoist.
  if (v in WEEKDAY_ALIASES) {
    const delta = (WEEKDAY_ALIASES[v]! - today.getDay() + 7) % 7;
    return format(addDays(today, delta), "yyyy-MM-dd");
  }

  const plus = v.match(/^\+(\d{1,3})$/);
  if (plus) return format(addDays(today, Number(plus[1])), "yyyy-MM-dd");

  // ISO passes through verbatim, including past dates — an explicit date is
  // the user's business. Reject impossible ones (2026-02-31) by round-trip.
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const real =
      d.getFullYear() === Number(iso[1]) &&
      d.getMonth() === Number(iso[2]) - 1 &&
      d.getDate() === Number(iso[3]);
    return real ? v : null;
  }

  // M/D (or M-D): this year, rolling to next year once the date has passed —
  // "due:1/5" typed in July means January coming, not January gone.
  const md = v.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    let d = new Date(today.getFullYear(), month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    const midnightToday = new Date(
      today.getFullYear(), today.getMonth(), today.getDate(),
    );
    if (d < midnightToday) d = addYears(d, 1);
    return format(d, "yyyy-MM-dd");
  }

  return null;
}

export function parseQuickAdd(
  raw: string,
  today: Date = new Date(),
): QuickAddParse {
  const result: QuickAddParse = {
    title: "",
    priority: null,
    category: null,
    assignedTo: null,
    dueDate: null,
  };

  const kept: string[] = [];

  for (const token of raw.split(/\s+/)) {
    if (token === "") continue;

    const priority = token.match(/^!([a-z]+)$/i);
    if (priority) {
      const mapped = PRIORITY_ALIASES[priority[1]!.toLowerCase()];
      if (mapped) {
        result.priority = mapped;
        continue;
      }
    }

    const category = token.match(/^#([a-z_-]+)$/i);
    if (category) {
      const mapped =
        CATEGORY_ALIASES[category[1]!.toLowerCase().replace(/-/g, "_")];
      if (mapped) {
        result.category = mapped;
        continue;
      }
    }

    if (token.length > 1 && token.startsWith("@")) {
      result.assignedTo = token.slice(1);
      continue;
    }

    const due = token.match(/^due:(.+)$/i);
    if (due) {
      const parsed = parseDueValue(due[1]!, today);
      if (parsed) {
        result.dueDate = parsed;
        continue;
      }
    }

    kept.push(token);
  }

  result.title = kept.join(" ");
  return result;
}
