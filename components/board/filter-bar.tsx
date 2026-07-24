"use client";

import { useEffect, useState } from "react";
import { Calendar, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  type ItemCategory,
  type ItemPriority,
  type ItemStatus,
  categoryLabels,
  priorityLabels,
  statusLabels,
  categoryColors,
  priorityColors,
  statusColors,
} from "@/lib/types";

export type DueDateFilter =
  | "overdue"
  | "today"
  | "thisWeek"
  | "noDate"
  | null;

export interface BoardFilters {
  search: string;
  categories: ItemCategory[];
  priorities: ItemPriority[];
  statuses: ItemStatus[];
  dueDate: DueDateFilter;
}

interface Props {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  onToggleAddForm: () => void;
}

const DUE_DATE_OPTIONS: {
  key: NonNullable<DueDateFilter>;
  label: string;
  color: string;
}[] = [
  { key: "overdue", label: "Overdue", color: "border-red-500/40 bg-red-500/15 text-red-300" },
  { key: "today", label: "Today", color: "border-orange-500/40 bg-orange-500/15 text-orange-300" },
  { key: "thisWeek", label: "This Week", color: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
  { key: "noDate", label: "No Date", color: "border-slate-500/40 bg-slate-500/15 text-slate-300" },
];

/** Live local-time card. Re-renders every minute, aligned to the next
 *  minute boundary so seconds don't drift the displayed time. SSR-safe:
 *  starts blank on the server and hydrates client-side. */
function LocalClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Align to next minute boundary, then tick every 60s.
    const msToNext = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, msToNext);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  const date = now
    ? now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  const time = now
    ? now.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="flex h-9 items-center justify-center gap-2 overflow-hidden rounded-md border border-border bg-card/50 px-3">
      <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
      <span className="truncate text-xs text-muted-foreground">{date}</span>
      <span className="text-muted-foreground/40">·</span>
      <span className="truncate text-sm font-bold tabular-nums text-foreground">
        {time}
      </span>
    </div>
  );
}

function FilterPills<T extends string>({
  label,
  options,
  selected,
  labels,
  colors,
  onToggle,
  onClearGroup,
}: {
  label: string;
  options: T[];
  selected: T[];
  labels: Record<T, string>;
  colors: Record<T, string>;
  onToggle: (val: T) => void;
  onClearGroup: () => void;
}) {
  const hasSelection = selected.length > 0;
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-sky-300/30" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-300">
          {label}
        </span>
        <div className="h-px flex-1 bg-sky-300/30" />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={onClearGroup}
          className={`w-full truncate rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
            !hasSelection
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-purple-300 hover:bg-accent hover:text-purple-200"
          }`}
        >
          All
        </button>
        {options.map((opt) => {
          const isActive = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={`w-full truncate rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? colors[opt]
                  : "border-border bg-card text-purple-300 hover:bg-accent hover:text-purple-200"
              }`}
              title={labels[opt]}
            >
              {labels[opt]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DueDateFilterPills({
  selected,
  onSelect,
  onClear,
}: {
  selected: DueDateFilter;
  onSelect: (key: NonNullable<DueDateFilter>) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-sky-300/30" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-300">
          Due Date
        </span>
        <div className="h-px flex-1 bg-sky-300/30" />
      </div>
      {/* 4 columns like every other card. A 5-wide row fits All + the four
          options on one line, but at a quarter of the bar's width it clips
          "Overdue", "This Week" and "No Date" — and buys nothing, because the
          cards stretch to a common height regardless. */}
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={onClear}
          className={`w-full truncate rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
            !selected
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-purple-300 hover:bg-accent hover:text-purple-200"
          }`}
        >
          All
        </button>
        {DUE_DATE_OPTIONS.map(({ key, label, color }) => {
          const isActive = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => (isActive ? onClear() : onSelect(key))}
              className={`w-full truncate rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? color
                  : "border-border bg-card text-purple-300 hover:bg-accent hover:text-purple-200"
              }`}
              title={label}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FilterBar({ filters, onChange, onToggleAddForm }: Props) {
  const hasFilters =
    filters.search ||
    filters.categories.length > 0 ||
    filters.priorities.length > 0 ||
    filters.statuses.length > 0 ||
    filters.dueDate;

  const toggleCategory = (cat: ItemCategory) => {
    const next = filters.categories.includes(cat)
      ? filters.categories.filter((c) => c !== cat)
      : [...filters.categories, cat];
    onChange({ ...filters, categories: next });
  };

  const togglePriority = (p: ItemPriority) => {
    const next = filters.priorities.includes(p)
      ? filters.priorities.filter((x) => x !== p)
      : [...filters.priorities, p];
    onChange({ ...filters, priorities: next });
  };

  const toggleStatus = (s: ItemStatus) => {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s];
    onChange({ ...filters, statuses: next });
  };

  return (
    <div className="space-y-3">
      {/* Search row — grid-cols-4 to align column boundaries with the
          stats + filter cards below: [Add(1)] [Search(2)] [Clock(1)]. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <button
          type="button"
          onClick={onToggleAddForm}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add New Task
        </button>

        <div className="flex items-center gap-2 md:col-span-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              className="h-9 pl-9"
            />
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  search: "",
                  categories: [],
                  priorities: [],
                  statuses: [],
                  dueDate: null,
                })
              }
              className="h-9 gap-1.5 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear All
            </Button>
          )}
        </div>

        <LocalClock />
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
        <FilterPills
          label="Status"
          options={
            [
              "pending",
              "in_progress",
              "done",
              "blocked",
              "future_phase",
            ] as ItemStatus[]
          }
          selected={filters.statuses}
          labels={statusLabels}
          colors={statusColors}
          onToggle={toggleStatus}
          onClearGroup={() => onChange({ ...filters, statuses: [] })}
        />
        <FilterPills
          label="Priority"
          options={["high", "medium", "low"] as ItemPriority[]}
          selected={filters.priorities}
          labels={priorityLabels}
          colors={priorityColors}
          onToggle={togglePriority}
          onClearGroup={() => onChange({ ...filters, priorities: [] })}
        />
        <FilterPills
          label="Category"
          options={
            [
              "data_needed",
              "question",
              "decision",
              "task",
              "bug",
              "feature",
            ] as ItemCategory[]
          }
          selected={filters.categories}
          labels={categoryLabels}
          colors={categoryColors}
          onToggle={toggleCategory}
          onClearGroup={() => onChange({ ...filters, categories: [] })}
        />
        <DueDateFilterPills
          selected={filters.dueDate}
          onSelect={(key) => onChange({ ...filters, dueDate: key })}
          onClear={() => onChange({ ...filters, dueDate: null })}
        />
      </div>
    </div>
  );
}
