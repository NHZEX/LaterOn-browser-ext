import { EPOCH } from "./contracts.ts";
import type { CollectionAction, CollectionCommandResult, CollectionSuccess, CommandFields, EpochSnapshot } from "./contracts";

interface ClientEffects {
  readonly sendMessage: (message: Readonly<Record<string, unknown>>) => Promise<CollectionCommandResult | undefined>;
  readonly onInvalidated: () => void;
  readonly onFailure: (code: string) => void | Promise<void>;
}

export interface StorageClient {
  readonly initialize: (stored: EpochSnapshot) => void;
  readonly invalidate: () => void;
  run(action: "migrateLegacyData"): Promise<CollectionSuccess>;
  run<A extends CollectionAction>(action: A, fields: CommandFields<A>): Promise<CollectionSuccess>;
}

// Each page owns its epoch; transport and presentation are supplied by its entry.
export function createStorageClient(effects: ClientEffects): StorageClient {
  let epoch: string | undefined;
  let invalidated = false;
  const initialize = (stored: EpochSnapshot): void => { if (epoch === undefined) epoch = stored[EPOCH] || ""; };
  const invalidate = (): void => {
    invalidated = true;
    effects.onInvalidated();
  };
  async function run(action: CollectionAction, fields: object = {}): Promise<CollectionSuccess> {
    if (epoch === undefined) throw new Error("COLLECTION_NOT_LOADED");
    const response: CollectionCommandResult | undefined = invalidated ? { ok: false, error: "STALE_COLLECTION" }
      : await effects.sendMessage({ ...fields, type: "COLLECTION_COMMAND", action, epoch })
        .catch(() => ({ ok: false, error: "COLLECTION_WRITE_FAILED" }));
    if (response?.ok === true) return response;
    const code = response?.error || "COLLECTION_WRITE_FAILED";
    await effects.onFailure(code);
    throw new Error(code);
  }
  return { initialize, invalidate, run };
}
