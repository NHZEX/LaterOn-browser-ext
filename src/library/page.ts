import type { LegacyCollectionState } from "../storage/contracts";
import type { StoredSettings } from "../settings/shared";

export const SETTINGS = "laterOnSettings", FILTER = "laterOnFilter", FILTER_CHOSEN = "laterOnFilterChosen";
export const SIDEBAR_WIDTH = "laterOnSidebarWidth";

export interface LibrarySnapshot extends LegacyCollectionState {
  readonly laterOnSettings?: StoredSettings;
  readonly laterOnFilter?: unknown;
  readonly laterOnFilterChosen?: boolean;
  readonly laterOnSidebarWidth?: unknown;
}
