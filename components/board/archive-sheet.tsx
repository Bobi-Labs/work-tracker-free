"use client";

/**
 * The archive — where Done cards go to get out of the way.
 *
 * A Sheet, not a route, for the same load-bearing reason as settings-sheet.tsx:
 * `output: 'export'` + a second route = a 404 on hard-refresh from any static
 * host, and a `file://` build has no server to ask at all.
 *
 * Archiving is the NON-destructive alternative to deleting the Done column:
 * `archivedAt` is stamped, `status` is untouched, and Restore drops the card
 * straight back into the column it left. Deletion exists only in here, per
 * item or all at once, both behind an inline confirm — the archive is the one
 * place in the app where "remove forever" is allowed to live, precisely
 * because everything in it has already been moved out of the way once.
 */

import { useEffect, useState } from "react";
import { ArchiveRestore, Inbox, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  categoryColors,
  categoryLabels,
  statusColors,
  statusLabels,
  type Item,
} from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already filtered to `archivedAt !== null` by the orchestrator. */
  items: Item[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}

export function ArchiveSheet({
  open,
  onOpenChange,
  items,
  onRestore,
  onDelete,
  onDeleteAll,
}: Props) {
  /** Which destructive action is one click from firing: an item id, or "all". */
  const [confirming, setConfirming] = useState<string | null>(null);

  // A stale confirm must not survive a close/reopen — reopening the sheet to
  // find a red "Delete forever" already armed is how misclicks eat data.
  useEffect(() => {
    if (!open) setConfirming(null);
  }, [open]);

  // Most recently archived first — the thing you just archived is the thing
  // you are most likely to want back.
  const sorted = [...items].sort((a, b) =>
    (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Archive</SheetTitle>
          <SheetDescription>
            {items.length === 0
              ? "Cards you archive land here, off the board."
              : `${items.length} archived card${items.length === 1 ? "" : "s"}. Restoring puts a card back in the column it left.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-8">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
              <Inbox className="h-6 w-6 text-muted-foreground" />
              <p className="max-w-[26ch] text-sm text-muted-foreground">
                Nothing here yet. Use <strong>Archive</strong> on the Done
                column to sweep finished cards out of the way.
              </p>
            </div>
          ) : (
            <>
              {sorted.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-card/60 p-3"
                >
                  <p className="text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColors[item.status]}`}
                    >
                      {statusLabels[item.status]}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryColors[item.category]}`}
                    >
                      {categoryLabels[item.category]}
                    </span>
                    {item.archivedAt && (
                      <span className="text-[10px] text-muted-foreground">
                        archived{" "}
                        {new Date(item.archivedAt).toLocaleDateString()}
                      </span>
                    )}
                    {item.notes.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        · {item.notes.length} note
                        {item.notes.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    {confirming === item.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setConfirming(null);
                            onDelete(item.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete forever
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRestore(item.id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => setConfirming(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <div className="mt-2 border-t border-border pt-3">
                {confirming === "all" ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                    <p className="font-semibold text-red-400">
                      Delete all {items.length} archived card
                      {items.length === 1 ? "" : "s"} permanently?
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      This cannot be undone. Export the board first if you want
                      a copy.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirming(null);
                          onDeleteAll();
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete all
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirming("all")}
                    className="justify-start text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete all archived cards
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
