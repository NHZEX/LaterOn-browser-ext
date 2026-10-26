import type { LegacyCollectionState } from "../storage/contracts";
import type { StoredSettings } from "../settings/shared";

export const SETTINGS = "laterOnSettings", FILTER = "laterOnFilter", FILTER_CHOSEN = "laterOnFilterChosen";
export interface PanelSnapshot extends LegacyCollectionState {
  readonly laterOnSettings?: StoredSettings;
  readonly laterOnFilter?: unknown;
  readonly laterOnFilterChosen?: boolean;
}
export interface PageMetadata {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly image: string;
  readonly favicon: string;
}
export interface BootSegments { page: number; cache: number; paint: number; data: number; migrate: number; other?: number; bytes?: number; error?: string }

declare global {
  var LaterOnBoot: { readonly t0: number; stage(message: string): void; done(): void } | undefined;
}
