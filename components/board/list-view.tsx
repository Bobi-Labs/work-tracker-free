"use client";

import { useState, useMemo } from "react";
import {
  ArrowUpDown,
  CheckSquare,
  Square,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  priorityColors,
  categoryColors,
  statusColors,
  priorityLabels,
  categoryLabels,
  statusLabels,
  type Item,
  type ItemPriority,
  type ItemStatus,
} from "@/lib/types";

type SortKey =
  | "title"
  | "priority"
  | "status"
  | "category"
  | "createdAt"
  | "description";

const priorityOrder: Record<ItemPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * TABLE SORT ORDER — deliberately NOT `statusOrder` from lib/types.
 *
 * `statusOrder` is the Kanban COLUMN order (pending first: it is the intake
 * column, and you read a board left-to-right as work flows). A sorted table is
 * a triage list, so it leads with what is on fire: blocked, then in-progress.
 * Two different questions, two different orderings. Do not unify them.
 */
const statusOrderMap: Record<ItemStatus, number> = {
  blocked: 0,
  in_progress: 1,
  pending: 2,
  done: 3,
  future_phase: 4,
};

interface Props {
  items: Item[];
  onItemClick: (item: Item) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkAction: (action: "done" | "in_progress" | "pending") => void;
  /**
   * Required, unlike the private app's optional prop. There is no permission
   * model here — every board is editable — so an unwired quick-done button is a
   * bug, and a required prop makes the compiler say so instead of silently
   * rendering a table with no way to complete anything.
   */
  onStatusChange: (itemId: string, status: ItemStatus) => void;
}

export function ListView({
  items,
  onItemClick,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkAction,
  onStatusChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "priority":
          cmp = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        case "status":
          cmp = statusOrderMap[a.status] - statusOrderMap[b.status];
          break;
        case "category":
          cmp = a.category.localeCompare(b.category);
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
        case "description":
          cmp = (a.description ?? "").localeCompare(b.description ?? "");
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [items, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => onBulkAction("done")}
            className="h-7 text-xs"
          >
            Mark Done
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onBulkAction("in_progress")}
            className="h-7 text-xs"
          >
            In Progress
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onBulkAction("pending")}
            className="h-7 text-xs"
          >
            Reset
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            className="h-7 text-xs text-muted-foreground"
          >
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2">
                <button
                  type="button"
                  onClick={allSelected ? onClearSelection : onSelectAll}
                >
                  {allSelected ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              </th>
              {(
                [
                  ["status", "Status"],
                  ["priority", "Priority"],
                  ["category", "Category"],
                  ["title", "Title"],
                  ["description", "Description"],
                  ["createdAt", "Created"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  className={`px-3 py-2 text-left font-medium ${
                    key === "description" ? "hidden md:table-cell" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {label}
                    <ArrowUpDown
                      className={`h-3 w-3 ${sortKey === key ? "text-primary" : ""}`}
                    />
                  </button>
                </th>
              ))}
              <th className="w-10 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const isSelected = selectedIds.has(item.id);
              // Notes are embedded in the item now. The private app fetched
              // these counts with a `tracker_notes` query from inside this
              // otherwise-presentational component — there is nothing to fetch.
              const noteCount = item.notes.length;
              const desc = item.description ?? "";
              const truncated =
                desc.length > 60 ? desc.slice(0, 60) + "..." : desc;

              return (
                <tr
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  className={`border-b border-border transition-colors hover:bg-accent cursor-pointer ${
                    isSelected ? "bg-primary/5" : ""
                  }`}
                >
                  <td
                    className="px-3 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleSelect(item.id)}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        statusColors[item.status]
                      }`}
                    >
                      {statusLabels[item.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        priorityColors[item.priority]
                      }`}
                    >
                      {priorityLabels[item.priority]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        categoryColors[item.category]
                      }`}
                    >
                      {categoryLabels[item.category]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-foreground">
                      {item.title}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell max-w-[250px]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-xs text-muted-foreground truncate block">
                        {truncated || (
                          <span className="italic">No description</span>
                        )}
                      </span>
                      {noteCount > 0 && (
                        <span className="flex-shrink-0 inline-flex items-center gap-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[9px] font-bold text-purple-400">
                          <MessageSquare className="h-2.5 w-2.5" />
                          {noteCount}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td
                    className="px-3 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.status !== "done" && (
                      <button
                        type="button"
                        onClick={() => onStatusChange(item.id, "done")}
                        className="rounded-full p-1.5 transition-colors bg-green-500/10 hover:bg-green-500/30 text-green-500/50 hover:text-green-400"
                        title="Mark done"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No items match your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
