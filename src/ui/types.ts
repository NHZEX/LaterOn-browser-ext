export interface PromptOptions {
  readonly title: string;
  readonly message?: string;
  readonly confirmText: string;
  readonly fields: readonly { readonly name: string; readonly label: string; readonly value?: string;
    readonly placeholder?: string; readonly maxLength?: number; readonly multiline?: boolean; readonly rows?: number }[];
  readonly cover?: { readonly name: string; readonly label: string; readonly value: string; readonly derived?: boolean;
    readonly note?: string; readonly removedNote?: string; readonly candidates?: readonly { readonly id: string; readonly src: string; readonly title: string }[];
    readonly picks?: readonly string[]; readonly picksName?: string; readonly picksLabel?: string; readonly maxPicks?: number; readonly picksNote?: string };
}
export type PromptValues = Readonly<Record<string, string | readonly string[] | null | undefined>>;
