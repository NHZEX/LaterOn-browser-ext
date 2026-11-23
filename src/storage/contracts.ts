import type { BackupItem, BackupProject } from "../backup/core";
import type { IconMap } from "./icons";
import type { EditRecoveryEntry } from "./edit-recovery";
import type { SyncMeta } from "../sync/binding";
import type { DiscourseTopic } from "../shared/discourse-topic";
import { ICONS } from "./icons.ts";
export { ICONS } from "./icons.ts";

// Local records can predate the complete, validated backup format.
// favicon may also hold an internal icon:// reference, resolved before backup validation.
export const ITEM_TEXT_FIELDS = ["title", "description"] as const;
export type ItemTextField = typeof ITEM_TEXT_FIELDS[number];
interface ItemTextVersion { readonly value: string | null; readonly revision: string | null; readonly sourceId?: string }
export type ItemEditBasis = Readonly<Record<ItemTextField, ItemTextVersion>> & { readonly bindingId?: string };
export type StoredItem = Pick<BackupItem, "id"> & Partial<Omit<BackupItem, "id">> & {
  readonly editRevisions?: Readonly<Partial<Record<ItemTextField, string>>>;
  readonly textAuthors?: Readonly<Partial<Record<ItemTextField, string>>>;
};
export type StoredProject = Pick<BackupProject, "id"> & Partial<Omit<BackupProject, "id">>;

export const ITEMS = "laterOnItems", PROJECTS = "laterOnProjects", COVERS = "laterOnCovers";
export const ORDER = "laterOnOrder", POSITIONS = "laterOnReadingPositions";
export const CURRENT = "laterOnCurrentItem", ACTIVE = "laterOnActiveProject";
export const KEYS = [ITEMS, PROJECTS, COVERS, ICONS, ORDER, POSITIONS] as const;
export const EPOCH = "laterOnCollectionEpoch";
export const OVERRIDE_LOG = "laterOnOverrideLog";

export interface EpochSnapshot {
  readonly laterOnCollectionEpoch?: string;
}

export interface CollectionState extends EpochSnapshot {
  readonly laterOnOverrideLog?: readonly EditRecoveryEntry[];
  readonly laterOnItems?: readonly StoredItem[];
  readonly laterOnProjects?: readonly StoredProject[];
  readonly laterOnCovers?: Readonly<Record<string, string>>;
  readonly laterOnIcons?: IconMap;
  readonly laterOnOrder?: Readonly<Record<string, readonly string[]>>;
  readonly laterOnReadingPositions?: Readonly<Record<string, number>>;
  readonly laterOnCurrentItem?: string | null;
  readonly laterOnActiveProject?: string;
}

export type LegacyCollectionState = Omit<CollectionState, "laterOnItems"> & {
  readonly laterOnItems?: readonly (StoredItem | null)[];
};

export interface ItemChanges {
  readonly title?: string;
  readonly description?: string;
  readonly titleEdited?: boolean;
  readonly descriptionEdited?: boolean;
  readonly imageEdited?: boolean;
  readonly status?: BackupItem["status"];
  readonly projectId?: string | null;
  readonly cover?: string;
}

export interface ProjectChanges {
  readonly name?: string;
  readonly note?: string;
  readonly cover?: string;
  readonly coverPick?: readonly string[];
  readonly archived?: boolean;
}

export type CollectionOperation =
  | { readonly action: "createProject"; readonly name: string }
  | { readonly action: "updateProject"; readonly id: string; readonly changes: ProjectChanges }
  | { readonly action: "setProjectPinned"; readonly id: string; readonly pinned: boolean }
  | { readonly action: "moveProject"; readonly id: string; readonly beforeId: string | null }
  | { readonly action: "deleteProject"; readonly id: string }
  | { readonly action: "moveItem"; readonly id: string; readonly scope: string; readonly beforeId: string | null }
  | { readonly action: "updateDiscoursePosition"; readonly id: string; readonly expectedUrl: string; readonly url: string; readonly topic: DiscourseTopic }
  | { readonly action: "mutateItems"; readonly operation: "update" | "delete"; readonly ids: readonly string[]; readonly patch?: ItemChanges;
      readonly editBasis?: ItemEditBasis; readonly deleteBindingId?: string | null }
  | { readonly action: "listEditRecovery" }
  | { readonly action: "clearEditRecovery" }
  | { readonly action: "migrateLegacyData" };

export type CollectionAction = CollectionOperation["action"];
export type Operation<A extends CollectionAction> = Extract<CollectionOperation, { readonly action: A }>;
export type CommandFields<A extends CollectionAction> = A extends CollectionAction ? Omit<Operation<A>, "action"> : never;
export type CollectionCommand = CollectionOperation & { readonly epoch?: string };

export interface CollectionResponse {
  readonly syncMeta?: SyncMeta;
  readonly editRecovery?: readonly EditRecoveryEntry[];
  readonly items?: readonly StoredItem[];
  readonly projects?: readonly StoredProject[];
  readonly project?: StoredProject;
  readonly covers?: Readonly<Record<string, string>>;
  readonly icons?: IconMap;
  readonly orders?: Readonly<Record<string, readonly string[]>>;
  readonly affected?: number;
  readonly existed?: boolean;
  readonly editConflict?: "partial" | "pending";
}

export type CollectionSuccess = CollectionResponse & { readonly ok: true };
export type CollectionCommandResult = CollectionSuccess | { readonly ok: false; readonly error: string };

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isAnchor = (value: unknown): boolean => value === null || isString(value);
const isStatus = (value: unknown): boolean => value === "unread" || value === "reading" || value === "done";

const isChanges = (value: unknown, checks: Readonly<Record<string, (entry: unknown) => boolean>>): boolean =>
  isRecord(value) && Object.entries(value).every(([key, entry]) => Object.hasOwn(checks, key) && !!checks[key]?.(entry));

const isItemChanges = (value: unknown): value is ItemChanges => isChanges(value, {
  title: isString, description: isString, cover: isString, status: isStatus, projectId: isAnchor,
  titleEdited: (entry) => typeof entry === "boolean", descriptionEdited: (entry) => typeof entry === "boolean",
  imageEdited: (entry) => typeof entry === "boolean"
});

const isProjectChanges = (value: unknown): value is ProjectChanges => isChanges(value, {
  name: isString, note: isString, cover: isString, archived: (entry) => typeof entry === "boolean",
  coverPick: (entry) => Array.isArray(entry) && entry.every(isString)
});

const isTextVersion = (value: unknown): value is ItemTextVersion => isRecord(value) && isAnchor(value.value) && isAnchor(value.revision)
  && (value.sourceId === undefined || isString(value.sourceId));
const isEditBasis = (value: unknown): value is ItemEditBasis => isRecord(value) && isTextVersion(value.title) && isTextVersion(value.description)
  && (value.bindingId === undefined || isString(value.bindingId));

// Runtime messages remain untrusted even when extension callers use TS types.
export function isCollectionCommand(value: unknown): value is CollectionCommand {
  if (!isRecord(value) || (value.epoch !== undefined && !isString(value.epoch))) return false;
  switch (value.action) {
    case "createProject": return isString(value.name);
    case "updateProject": return isString(value.id) && isProjectChanges(value.changes);
    case "setProjectPinned": return isString(value.id) && typeof value.pinned === "boolean";
    case "moveProject": return isString(value.id) && isAnchor(value.beforeId);
    case "deleteProject": return isString(value.id);
    case "moveItem": return isString(value.id) && isString(value.scope) && isAnchor(value.beforeId);
    case "updateDiscoursePosition": return isString(value.id) && isString(value.expectedUrl) && isString(value.url)
      && isRecord(value.topic) && isString(value.topic.origin) && isString(value.topic.basePath)
      && isString(value.topic.topicId) && isAnchor(value.topic.postNumber);
    case "mutateItems": return (value.operation === "update" || value.operation === "delete")
      && Array.isArray(value.ids) && value.ids.every(isString) && (value.patch === undefined || isItemChanges(value.patch))
      && (value.editBasis === undefined || (value.operation === "update" && value.ids.length === 1 && isEditBasis(value.editBasis)))
      && (value.deleteBindingId === undefined || (value.operation === "delete" && (value.deleteBindingId === null || isString(value.deleteBindingId))));
    case "listEditRecovery":
    case "clearEditRecovery":
    case "migrateLegacyData": return true;
    default: return false;
  }
}
