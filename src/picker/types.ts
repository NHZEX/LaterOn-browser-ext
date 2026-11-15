import type { PickerSaveContext } from "../collection/picker-save-context";

export interface PickerProject {
  readonly id: string;
  readonly name?: string;
}

export interface PickerFolder extends PickerProject {
  readonly count?: number;
  readonly cover?: string;
  readonly matchedCount?: number;
}

export interface PickerPage {
  readonly title?: string;
  readonly url: string;
  readonly saved?: boolean;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly archived?: boolean;
  readonly missing?: boolean;
}

export interface FolderPickerOptions {
  readonly anchor?: HTMLElement;
  readonly selected?: string;
  readonly titleText?: string;
  readonly theme?: string;
  readonly language?: string;
  readonly folders?: readonly PickerFolder[];
  readonly pages?: readonly PickerPage[];
  readonly savedCount?: number;
  readonly saveContext?: PickerSaveContext;
  readonly onCreateProject?: (name: string) => PickerProject | null | Promise<PickerProject | null>;
  readonly onPick?: (id: string | null, name: string) => void | null | { readonly ok: boolean; readonly error?: string } | Promise<void | null | { readonly ok: boolean; readonly error?: string }>;
  readonly onCancel?: () => unknown;
}