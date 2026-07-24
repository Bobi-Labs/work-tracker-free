"use client";

/**
 * The "Add New Task" card. Renders inline above the board (it is a card, not a
 * dialog — the source file's name lied), toggled by the FilterBar's Add button.
 *
 * ⚠️ THE ONLY REQUIRED FIELD IS `title`.
 *
 * The private app's version blocked submit on `!title.trim() || !assignedTo.trim()`
 * — in both `handleSubmit` and the button's `disabled` — because auth guaranteed
 * `assignedTo` was pre-filled with the signed-in user's display name. This app has
 * no auth, no assignment field and no `@` token, so that clause would leave the
 * Create button permanently, silently disabled: a form that renders perfectly and
 * cannot submit. Both guards are title-only. Do not "restore" the assignee check.
 */

import { useId, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Zap, X } from "lucide-react";

import { parseQuickAdd } from "@/lib/quick-add";
import {
  categoryLabels,
  priorityLabels,
  type ItemCategory,
  type ItemPriority,
} from "@/lib/types";
import type { NewItemInput } from "@/lib/store/board-doc";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Typed as the store's own input, so the intended wiring is literally
   * `onSubmit={store.addItem}` — anything else is a compile error rather than a
   * shape that drifts from the document model.
   */
  onSubmit: (input: NewItemInput) => void;
}

export function NewItemForm({ open, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  // `category` had NO database default and was NOT NULL, so `NewItemInput`
  // requires it. This default IS the constraint now.
  const [category, setCategory] = useState<ItemCategory>("task");
  const [priority, setPriority] = useState<ItemPriority>("medium");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  /**
   * Quick-add tokens, parsed live: `fix invoice !high #bug due:fri`.
   * A token beats its dropdown — it is the later, visible intent, and the
   * hint row below the input shows exactly what will be applied, so nothing
   * is silent. Unrecognised tokens stay in the title (see lib/quick-add.ts).
   */
  const parsed = useMemo(() => parseQuickAdd(title), [title]);
  const tokenHints = useMemo(() => {
    const hints: string[] = [];
    if (parsed.priority) hints.push(`${priorityLabels[parsed.priority]} priority`);
    if (parsed.category) hints.push(categoryLabels[parsed.category]);
    if (parsed.dueDate)
      hints.push(`due ${format(parseISO(parsed.dueDate), "EEE, MMM d")}`);
    return hints;
  }, [parsed]);

  const reset = () => {
    setTitle("");
    setCategory("task");
    setPriority("medium");
    setDescription("");
    setDueDate("");
  };

  const handleSubmit = () => {
    // Parse FRESH at submit — the memo above froze `today` at the last
    // keystroke, and a form left open across midnight would otherwise store
    // yesterday for `due:today`. The memo is for the hint; this is for real.
    const final = parseQuickAdd(title);
    // Title, and nothing else. See the note at the top of this file.
    // Guard on the PARSED title: "!high #bug" is a non-empty input whose
    // title is entirely tokens, and an untitled card is unfindable.
    if (!final.title.trim()) return;
    onSubmit({
      title: final.title,
      category: final.category ?? category,
      priority: final.priority ?? priority,
      description: description.trim() || null,
      dueDate: final.dueDate ?? (dueDate || null),
    });
    reset();
    onClose();
  };

  const handleCancel = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  const inputClass =
    "rounded-md border border-border bg-accent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors";
  const selectClass =
    "rounded-md border border-border bg-accent px-2 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors";

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?  (try: !high #bug due:fri)"
            className={`flex-1 ${inputClass}`}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) handleSubmit();
              if (e.key === "Escape") handleCancel();
            }}
          />
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Cancel"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {tokenHints.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3 text-primary" />
            <span>
              Sets:{" "}
              <span className="text-foreground">{tokenHints.join(" · ")}</span>
            </span>
          </div>
        )}

        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          className={`${inputClass} text-xs`}
        />

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ItemCategory)}
            aria-label="Category"
            className={selectClass}
          >
            {(Object.keys(categoryLabels) as ItemCategory[]).map((c) => (
              <option key={c} value={c}>
                {categoryLabels[c]}
              </option>
            ))}
          </select>

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ItemPriority)}
            aria-label="Priority"
            className={selectClass}
          >
            {(Object.keys(priorityLabels) as ItemPriority[]).map((p) => (
              <option key={p} value={p}>
                {priorityLabels[p]}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Due date"
            className={`${selectClass} w-36`}
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!parsed.title.trim()}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
