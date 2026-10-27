export interface PickerProject {
  readonly id: string;
  readonly name?: string;
}

export interface PickerFolder extends PickerProject {
  readonly count?: number;
  readonly cover?: string;
}

export interface FolderPickerOptions {
  readonly anchor?: HTMLElement;
  readonly selected?: string;
  readonly titleText?: string;
  readonly theme?: string;
  readonly language?: string;
  readonly folders?: readonly PickerFolder[];
  readonly pages?: readonly { readonly title?: string; readonly url: string }[];
  readonly savedCount?: number;
  readonly onCreateProject?: (name: string) => PickerProject | null | Promise<PickerProject | null>;
  readonly onPick?: (id: string | null, name: string) => void | null | { readonly ok: boolean; readonly error?: string } | Promise<void | null | { readonly ok: boolean; readonly error?: string }>;
  readonly onCancel?: () => unknown;
}
