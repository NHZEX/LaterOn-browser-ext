export interface PageMetadata {
  readonly title: string;
  readonly titleFrom: string;
  readonly description: string;
  readonly image: string;
  readonly imageFrom: string;
  readonly favicon: string;
  readonly source: string;
  readonly url: string;
  readonly videoId: string;
}

export function extractPageMetadataForShortcut(): PageMetadata;
