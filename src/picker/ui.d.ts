import type { FolderPickerOptions } from "./types";

export function openFolderPicker(options: FolderPickerOptions): { readonly close: () => void };
