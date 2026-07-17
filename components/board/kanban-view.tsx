"use client";

import { useMemo, useState, useEffect } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Archive } from "lucide-react";
import {
  statusColors,
  statusLabels,
  statusOrder,
  type Item,
  type ItemStatus,
} from "@/lib/types";
import { ItemCard } from "./item-card";

interface Props {
  items: Item[];
  onItemClick: (item: Item) => void;
  onStatusChange: (itemId: string, newStatus: ItemStatus) => void;
  /**
   * Wire this to `store.reorderItems(status, orderedIds)` — nothing else.
   *
   * The store owns BOTH halves of a drop: it rewrites `sortOrder` as `index * 10`
   * across the destination column AND moves any id in `orderedIds` that wasn't
   * already in `status` (re-deriving `completedAt` on the way). That is why a
   * cross-column drag below does not also fire `onStatusChange` — it would be a
   * redundant second commit of a move the reorder already performed.
   */
  onReorder: (status: ItemStatus, orderedIds: string[]) => void;
  /**
   * Archives (does NOT delete) every Done card — `store.archiveDone()`.
   * Required, not optional: an un-passed callback would silently hide the button.
   */
  onArchiveDone: () => void;
}

export function KanbanView({
  items,
  onItemClick,
  onStatusChange,
  onReorder,
  onArchiveDone,
}: Props) {
  // DnD requires client-side only rendering (SSR hydration mismatch fix).
  // `output: 'export'` still PRERENDERS at build time, so this guard is load-bearing
  // even though there is no server. Do not remove it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const columns = useMemo(() => {
    const map: Record<ItemStatus, Item[]> = {
      pending: [],
      in_progress: [],
      done: [],
      blocked: [],
      future_phase: [],
    };
    for (const item of items) {
      map[item.status].push(item);
    }
    for (const status of statusOrder) {
      map[status].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [items]);

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const sourceStatus = source.droppableId as ItemStatus;
    const destStatus = destination.droppableId as ItemStatus;

    if (sourceStatus === destStatus && source.index === destination.index)
      return;

    const item = items.find((i) => i.id === draggableId);
    if (!item) return;

    // Rebuild the destination column in its post-drop order. The store turns this
    // into `sortOrder = index * 10` and moves the card into `destStatus` if needed.
    const destItems = [...columns[destStatus]];
    if (sourceStatus === destStatus) {
      destItems.splice(source.index, 1);
    }
    destItems.splice(destination.index, 0, item);

    onReorder(
      destStatus,
      destItems.map((it) => it.id),
    );
  };

  // Render static columns while waiting for mount (SSR hydration)
  if (!mounted) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-4">
        {statusOrder.map((status) => (
          <div key={status} className="min-w-[260px] flex-1">
            <div className="mb-2 flex items-center justify-between rounded-lg bg-card px-3 py-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusColors[status]}`}
              >
                {statusLabels[status]}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {columns[status].length}
              </span>
            </div>
            <div className="min-h-[100px] space-y-2 rounded-lg">
              {columns[status].map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={() => onItemClick(item)}
                  compact
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-2 overflow-x-auto pb-4">
        {statusOrder.map((status) => (
          <div key={status} className="min-w-[260px] flex-1">
            <div className="mb-2 flex items-center justify-between rounded-lg bg-card px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${statusColors[status]}`}
                >
                  {statusLabels[status]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {status === "done" && columns[status].length > 0 && (
                  // Non-destructive, so no confirm: every card lands in the
                  // archive (header, box icon) and restores with one click.
                  <button
                    type="button"
                    onClick={onArchiveDone}
                    title="Archive all Done cards. They move to the archive, off the board, and can be restored any time."
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    <Archive className="h-3 w-3" />
                    Archive
                  </button>
                )}
                <span className="text-xs font-mono text-muted-foreground">
                  {columns[status].length}
                </span>
              </div>
            </div>

            <Droppable droppableId={status}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-[100px] space-y-2 rounded-lg transition-colors ${
                    snapshot.isDraggingOver ? "bg-primary/5" : ""
                  }`}
                >
                  {columns[status].map((item, index) => (
                    <Draggable
                      key={item.id}
                      draggableId={item.id}
                      index={index}
                    >
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          className={`${dragSnapshot.isDragging ? "opacity-80 rotate-1" : ""}`}
                        >
                          <ItemCard
                            item={item}
                            onClick={() => onItemClick(item)}
                            onQuickDone={() => onStatusChange(item.id, "done")}
                            onMoveBack={
                              statusOrder.indexOf(status) > 0
                                ? () =>
                                    onStatusChange(
                                      item.id,
                                      statusOrder[
                                        statusOrder.indexOf(status) - 1
                                      ],
                                    )
                                : undefined
                            }
                            onMoveForward={
                              statusOrder.indexOf(status) <
                              statusOrder.length - 1
                                ? () =>
                                    onStatusChange(
                                      item.id,
                                      statusOrder[
                                        statusOrder.indexOf(status) + 1
                                      ],
                                    )
                                : undefined
                            }
                            compact
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  );
}
