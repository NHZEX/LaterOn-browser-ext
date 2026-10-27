import type { PromptOptions, PromptValues } from "./types";

export interface DialogOptions {
  readonly tone?: "question" | "danger" | "info" | "success";
  readonly title?: string;
  readonly message?: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly cancelable?: boolean;
  readonly hint?: string;
}
export interface DialogService {
  confirm(input: string | DialogOptions): Promise<boolean>;
  alert(input: string | DialogOptions): Promise<boolean>;
  prompt(input: Omit<PromptOptions, "fields" | "cover" | "confirmText"> & DialogOptions & (
    { readonly fields: PromptOptions["fields"]; readonly cover?: PromptOptions["cover"] }
    | { readonly fields?: PromptOptions["fields"]; readonly cover: NonNullable<PromptOptions["cover"]> }
  )): Promise<{ readonly ok: boolean; readonly values: PromptValues | null } | false>;
  close(): void;
  dispose(): void;
  isOpen(): boolean;
}
export const dialog: DialogService;
