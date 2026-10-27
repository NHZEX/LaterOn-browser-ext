import type { FolderPickerOptions } from "../picker/types";

export function showFolderPickerOverlay(payload: FolderPickerOptions & { readonly batchId?: string }): void;
export function registerFolderPicker(): void;
