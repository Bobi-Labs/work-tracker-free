"use client";

import { useState, useEffect } from "react";
import {
  Archive,
  Send,
  Trash2,
  Save,
  Pencil,
  Check,
  X,
  MessageSquare,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/board/markdown";
import type { ItemPatch } from "@/lib/store/board-doc";
import {
  statusColors,
  statusLabels,
  statusOrder,
  priorityLabels,
  categoryLabels,
  type Item,
  type ItemCategory,
  type ItemPriority,
  type ItemStatus,
  type Note,
} from "@/lib/types";

/**
 * The comment list.
 *
 * The private app rendered this component TWICE — once for notes whose author
 * passed `isDevTeam()`, once for everyone else — with a live Dev-Team/Client
 * badge on the composer. That partition existed to show a client that the
 * agency had replied. `Note` in this app has no `author` (see lib/types.ts:191:
 * "there is one user and it is you"), so there is nothing to partition on and
 * one flat list is the whole truth.
 */
function NoteSection({
  notes,
  editingNoteId,
  editingNoteContent,
  setEditingNoteContent,
  confirmDeleteNoteId,
  onEditNote,
  onSaveNote,
  onCancelEdit,
  onRequestDeleteNote,
  onConfirmDeleteNote,
  onCancelDeleteNote,
}: {
  notes: Note[];
  editingNoteId: string | null;
  editingNoteContent: string;
  setEditingNoteContent: (val: string) => void;
  confirmDeleteNoteId: string | null;
  onEditNote: (note: Note) => void;
  onSaveNote: (noteId: string) => void;
  onCancelEdit: () => void;
  onRequestDeleteNote: (noteId: string) => void;
  onConfirmDeleteNote: (noteId: string) => void;
  onCancelDeleteNote: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Comments
        </span>
        <span className="rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
          {notes.length}
        </span>
      </div>

      {notes.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No comments yet</p>
      ) : (
        <div className="max-h-[240px] space-y-2 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              className="rounded-md border border-border bg-card/80 p-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(note.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                {editingNoteId !== note.id &&
                  confirmDeleteNoteId !== note.id && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditNote(note)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        title="Edit comment"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestDeleteNote(note.id)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        title="Delete comment"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
              </div>

              {editingNoteId === note.id ? (
                <div className="mt-1.5 space-y-1.5">
                  <Textarea
                    value={editingNoteContent}
                    onChange={(e) => setEditingNoteContent(e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => onSaveNote(note.id)}
                      className="h-6 gap-1 text-[10px]"
                    >
                      <Check className="h-3 w-3" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onCancelEdit}
                      className="h-6 gap-1 text-[10px]"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {note.content}
                  </p>
                  {/* Deleting a comment is unrecoverable — there is no server-side
                      copy to restore from — so it takes the same two-step confirm
                      the item delete does. */}
                  {confirmDeleteNoteId === note.id && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-xs text-destructive">
                        Delete this comment?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onConfirmDeleteNote(note.id)}
                        className="h-6 text-[10px]"
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onCancelDeleteNote}
                        className="h-6 text-[10px]"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  /**
   * ⚠️ MUST be derived from the live document on every render — e.g.
   * `doc.items.find((i) => i.id === selectedId) ?? null` — and NOT held in
   * `useState<Item | null>` captured at click time.
   *
   * Comments render from `item.notes`, so a captured snapshot means a comment
   * the user just posted never appears, with no error anywhere. (The private
   * dashboard DID hold a snapshot, and paid for it with a hand-written
   * re-sync inside its optimistic-update block — that machinery is exactly
   * what a synchronous store deletes. Hold the id, look up the item.)
   */
  item: Item | null;
  open: boolean;
  onClose: () => void;
  /** Wire to `store.updateItem`. `completedAt` is derived there — never patch it. */
  onUpdate: (id: string, patch: ItemPatch) => void;
  onDelete: (id: string) => void;
  /**
   * Wire to `store.archiveItem` (via the orchestrator, which also clears the
   * selection — an archived item leaves the board, so the panel must close).
   * Archive is the reversible sibling of delete: no confirm step, because the
   * Archive sheet can always bring the item back.
   */
  onArchive: (id: string) => void;
  /** Wire to `store.addNote` / `updateNote` / `deleteNote`. */
  onAddNote: (itemId: string, content: string) => void;
  onUpdateNote: (itemId: string, noteId: string, content: string) => void;
  onDeleteNote: (itemId: string, noteId: string) => void;
}

/**
 * No `canEdit`. There is one user, it is their machine, and the board is always
 * editable — a permission prop here would default to `undefined` and render a
 * detail panel that looks perfect and silently refuses to save.
 *
 * No `projectId` either: it existed solely to address the @mention Telegram
 * notify endpoint, and there are no API routes in a static export.
 */
export function ItemDetail({
  item,
  open,
  onClose,
  onUpdate,
  onDelete,
  onArchive,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: Props) {
  const [newNote, setNewNote] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<ItemPriority>("medium");
  const [category, setCategory] = useState<ItemCategory>("task");
  const [localStatus, setLocalStatus] = useState<ItemStatus>("pending");
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * Description is rendered as markdown when it has content and the user is
   * not editing it. Clicking the rendered text (or the pencil) swaps in the
   * textarea. An empty description shows the textarea directly — there is
   * nothing to render, and a hidden empty editor reads as a missing feature.
   */
  const [editingDescription, setEditingDescription] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(
    null,
  );
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);

  // Seed the form from the item ONCE per item — keyed on id, not on the object.
  // The `item` prop is live, so it changes identity on every save; re-syncing on
  // every change would yank half-typed text out from under the user.
  useEffect(() => {
    if (!item) return;
    if (item.id === loadedItemId) return;

    setLoadedItemId(item.id);
    setTitle(item.title);
    setDescription(item.description ?? "");
    setDueDate(item.dueDate ?? "");
    setPriority(item.priority);
    setCategory(item.category);
    setLocalStatus(item.status);
    setConfirmDelete(false);
    setEditingDescription(false);
    setDirty(false);
    setEditingNoteId(null);
    setConfirmDeleteNoteId(null);
    setNewNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Reopening the SAME item skips the seed effect above (loadedItemId still
  // matches), so transient view state must reset on close or a description
  // editor left open comes back wedged open next time.
  useEffect(() => {
    if (!open) {
      setEditingDescription(false);
      setConfirmDelete(false);
    }
  }, [open]);

  if (!item) return null;

  const handleStatusChange = (status: ItemStatus) => {
    setLocalStatus(status);
    onUpdate(item.id, { status });
  };

  const handleSave = () => {
    const patch: ItemPatch = {};
    if (title.trim() && title !== item.title) patch.title = title.trim();
    if (description !== (item.description ?? ""))
      patch.description = description || null;
    if (dueDate !== (item.dueDate ?? "")) patch.dueDate = dueDate || null;
    if (priority !== item.priority) patch.priority = priority;
    if (category !== item.category) patch.category = category;
    if (Object.keys(patch).length > 0) {
      onUpdate(item.id, patch);
    }
    setDirty(false);
    // Saving is the natural end of a description edit — collapse back to the
    // rendered view so the user sees what their markdown actually looks like.
    setEditingDescription(false);
  };

  const markDirty = () => setDirty(true);

  const handleAddNote = () => {
    const content = newNote.trim();
    if (!content) return;
    onAddNote(item.id, content);
    setNewNote("");
  };

  const handleEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingNoteContent(note.content);
  };

  const handleSaveNote = (noteId: string) => {
    const content = editingNoteContent.trim();
    if (!content) return;
    onUpdateNote(item.id, noteId, content);
    setEditingNoteId(null);
  };

  const handleDeleteNote = (noteId: string) => {
    onDeleteNote(item.id, noteId);
    setConfirmDeleteNoteId(null);
  };

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start justify-between">
            <SheetTitle className="flex-1 pr-4 text-left">
              {editingTitle ? (
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    markDirty();
                  }}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
                  autoFocus
                  className="text-lg font-bold"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="text-left transition-colors hover:text-primary"
                >
                  {title || item.title}
                </button>
              )}
            </SheetTitle>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6 px-4">
          {dirty && (
            <div className="sticky top-0 z-10 -mx-4 border-b border-primary/20 bg-background/95 px-4 py-2 backdrop-blur">
              <Button onClick={handleSave} size="sm" className="w-full gap-1.5">
                <Save className="h-3.5 w-3.5" />
                Save Changes
              </Button>
            </div>
          )}

          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Status
            </label>
            <div className="flex flex-wrap gap-1.5">
              {statusOrder.map((s) => {
                const isActive = localStatus === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStatusChange(s)}
                    className={`min-h-[36px] rounded-full border px-3 py-2 text-xs font-medium transition-all duration-150 active:scale-95 ${
                      isActive
                        ? `${statusColors[s]} ring-1 ring-offset-1 ring-offset-background ${
                            s === "done"
                              ? "ring-green-500/50"
                              : s === "in_progress"
                                ? "ring-blue-500/50"
                                : s === "blocked"
                                  ? "ring-red-500/50"
                                  : "ring-border"
                          }`
                        : "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:bg-accent"
                    }`}
                  >
                    {s === "done" && isActive ? "✓ " : ""}
                    {statusLabels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority / Category / Due Date. Due Date used to share a second
              row with Assigned To; with assignment gone it moves up here
              rather than sitting alone in a half-empty row. */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value as ItemPriority);
                  markDirty();
                }}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                {(["high", "medium", "low"] as ItemPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {priorityLabels[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as ItemCategory);
                  markDirty();
                }}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                {(
                  [
                    "data_needed",
                    "question",
                    "decision",
                    "task",
                    "bug",
                    "feature",
                  ] as ItemCategory[]
                ).map((c) => (
                  <option key={c} value={c}>
                    {categoryLabels[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Due Date
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  markDirty();
                }}
                className="h-9"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                Description
              </label>
              {!editingDescription && description.trim() !== "" && (
                <button
                  type="button"
                  onClick={() => setEditingDescription(true)}
                  aria-label="Edit description"
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            {editingDescription || description.trim() === "" ? (
              <>
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markDirty();
                  }}
                  // Clicking away with nothing changed collapses back to the
                  // rendered view — otherwise an accidental click into the
                  // editor has no exit at all (Save only renders when dirty).
                  onBlur={() => {
                    if (description === (item.description ?? ""))
                      setEditingDescription(false);
                  }}
                  placeholder="Add details..."
                  rows={editingDescription ? 6 : 3}
                  className="resize-none"
                  autoFocus={editingDescription}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Markdown supported: **bold**, `code`, - lists, - [ ] checkboxes, [links](https://…)
                </p>
              </>
            ) : (
              /* Click-to-edit. A real <button> would nest interactive elements
                 (the markdown can contain links), so this is a div with the
                 keyboard affordances added by hand. Link clicks stop their
                 propagation inside <Markdown>, so following one does not also
                 open the editor. */
              <div
                role="button"
                tabIndex={0}
                title="Click to edit"
                onClick={() => setEditingDescription(true)}
                onKeyDown={(e) => {
                  // Only when the wrapper ITSELF is focused. A markdown link
                  // inside is tabbable; Enter on it must follow the link, not
                  // get preventDefault'd into opening the editor.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditingDescription(true);
                  }
                }}
                className="-mx-1 cursor-text rounded-md border border-transparent px-1 py-0.5 transition-colors hover:border-border"
              >
                <Markdown text={description} />
              </div>
            )}
          </div>

          {dirty && (
            <Button onClick={handleSave} size="sm" className="w-full gap-1.5">
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </Button>
          )}

          {/* Notes are embedded in the item — there is nothing to fetch, so there
              is no loading state. */}
          <NoteSection
            notes={item.notes}
            editingNoteId={editingNoteId}
            editingNoteContent={editingNoteContent}
            setEditingNoteContent={setEditingNoteContent}
            confirmDeleteNoteId={confirmDeleteNoteId}
            onEditNote={handleEditNote}
            onSaveNote={handleSaveNote}
            onCancelEdit={() => setEditingNoteId(null)}
            onRequestDeleteNote={setConfirmDeleteNoteId}
            onConfirmDeleteNote={handleDeleteNote}
            onCancelDeleteNote={() => setConfirmDeleteNoteId(null)}
          />

          <div>
            <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Add Comment
            </label>
            <div className="relative">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
                className="resize-none pr-10"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleAddNote();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="absolute bottom-2 right-2 h-7 w-7 p-0"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive">
                  Delete this item?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onDelete(item.id);
                    onClose();
                  }}
                  className="h-7"
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                  className="h-7"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                {/* Archive first, delete second: the reversible action gets
                    the reachable spot, the destructive one keeps its confirm. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onArchive(item.id)}
                >
                  <Archive className="mr-1.5 h-3.5 w-3.5" />
                  Archive Item
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete Item
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
