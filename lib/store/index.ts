/** The store's public surface. Nothing outside `lib/store/` should reach past this. */

export type { StorageAdapter, StoreErrorKind } from "./adapters/types";
export { StoreError } from "./adapters/types";
export { MemoryAdapter } from "./adapters/memory";
export { LocalStorageAdapter } from "./adapters/local-storage";
export { createMirroredAdapter } from "./adapters/mirrored";

export {
  BOARD_FILE_EXTENSION,
  createFileSystemAdapter,
  ensurePermission,
  isFileSystemAccessSupported,
  openBoardFile,
  pickFileForBoard,
  queryFilePermission,
  suggestFileName,
  type FilePermission,
} from "./adapters/file-system";

export {
  boardIdsWithFiles,
  forgetBoardFileHandle,
  loadBoardFileHandle,
  saveBoardFileHandle,
} from "./file-handles";

export {
  EMPTY_BOARD_DOC,
  createDeliverable,
  createEmptyDoc,
  createEmptyIndex,
  createEmptySettings,
  createItem,
  createNote,
  createQuestion,
  isEmptyDoc,
  now,
  type DeliverablePatch,
  type ItemPatch,
  type NewDeliverableInput,
  type NewItemInput,
  type NewQuestionInput,
  type QuestionPatch,
} from "./board-doc";

export {
  SAVE_DEBOUNCE_MS,
  createBoardStore,
  type AttachOptions,
  type BoardStore,
  type BoardStoreOptions,
  type HydrateResult,
  type SaveState,
  type StoreStatus,
} from "./store";

export {
  EMPTY_WORKSPACE_INDEX,
  browserKV,
  createWorkspace,
  memoryKV,
  type Workspace,
  type WorkspaceKV,
} from "./workspace";

export {
  StoreProvider,
  useBoard,
  useBoardDoc,
  useBoardStatus,
  useBoardStore,
  useWorkspace,
  useWorkspaceIndex,
} from "./use-board";
