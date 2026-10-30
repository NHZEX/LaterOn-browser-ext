import type { BackupItem, BackupProject } from "../backup/core";
import type { IconMap } from "./icons";
import { ICONS } from "./icons.ts";
export { ICONS } from "./icons.ts";

// Local records can predate the complete, validated backup format.
// favicon may also hold an internal icon:// reference, resolved before backup validation.
export type StoredItem = Pick<BackupItem, "id"> & Partial<Omit<BackupItem, "id">>;
export type StoredProject = Pick<BackupProject, "id"> & Partial<Omit<BackupProject, "id">>;

export const ITEMS = "laterOnItems", PROJECTS = "laterOnProjects", COVERS = "laterOnCovers";
export const ORDER = "laterOnOrder", POSITIONS = "laterOnReadingPositions";
export const CURRENT = "laterOnCurrentItem", ACTIVE = "laterOnActiveProject";
export const KEYS = [ITEMS, PROJECTS, COVERS, ICONS, ORDER, POSITIONS] as const;
export const EPOCH = "laterOnCollectionEpoch";

export interface EpochSnapshot {
  readonly laterOnCollectionEpoch?: string;
}

export interface CollectionState extends EpochSnapshot {
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
  | { readonly action: "mutateItems"; readonly operation: "update" | "delete"; readonly ids: readonly string[]; readonly patch?: ItemChanges }
  | { readonly action: "migrateLegacyData" };

export type CollectionAction = CollectionOperation["action"];
export type Operation<A extends CollectionAction> = Extract<CollectionOperation, { readonly action: A }>;
export type CommandFields<A extends CollectionAction> = A extends CollectionAction ? Omit<Operation<A>, "action"> : never;
export type CollectionCommand = CollectionOperation & { readonly epoch?: string };

export interface CollectionResponse {
  readonly items?: readonly StoredItem[];
  readonly projects?: readonly StoredProject[];
  readonly project?: StoredProject;
  readonly covers?: Readonly<Record<string, string>>;
  readonly icons?: IconMap;
  readonly orders?: Readonly<Record<string, readonly string[]>>;
  readonly affected?: number;
  readonly existed?: boolean;
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
    case "mutateItems": return (value.operation === "update" || value.operation === "delete")
      && Array.isArray(value.ids) && value.ids.every(isString) && (value.patch === undefined || isItemChanges(value.patch));
    case "migrateLegacyData": return true;
    default: return false;
  }
}
