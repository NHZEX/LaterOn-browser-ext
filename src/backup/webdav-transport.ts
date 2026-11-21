import { DOMParser, onWarningStopParsing } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { MAX_ARCHIVE_BYTES } from "./webdav-archive";
import { budgetError } from "./webdav-meter";
import type { TransferMeter } from "./webdav-meter";
import { MIB } from "./webdav-shared";
import type { BackupSettings } from "./webdav-shared";

type Path = readonly string[];

export interface DavEntry {
  readonly name: string;
  readonly directory: boolean;
  readonly bytes: number | null;
}

const DAV_NAMESPACE = "DAV:";
const properties = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';

function davChildren(element: Element, localName: string): readonly Element[] {
  return Array.from(element.children).filter(child => child.namespaceURI === DAV_NAMESPACE && child.localName === localName);
}

function parseMultiStatus(xml: string): Element {
  try {
    const document = new DOMParser({ locator: false, onError: onWarningStopParsing }).parseFromString(xml, "application/xml");
    const root = document.documentElement;
    if (!document.doctype && root?.namespaceURI === DAV_NAMESPACE && root.localName === "multistatus") return root;
  } catch {
    // A malformed listing cannot be used for rotation.
  }
  throw new Error("WEBDAV_LIST");
}

const successStatus = (status: Element) => /^HTTP\/\d(?:\.\d)? 2\d\d(?: |$)/.test(status.textContent?.trim() ?? "");

function successfulResourceType(response: Element): Element | undefined {
  const status = davChildren(response, "status");
  if (status.some(entry => !successStatus(entry))) return;
  const properties = davChildren(response, "propstat").filter(entry => {
    const result = davChildren(entry, "status");
    return result.length === 1 && result.every(successStatus);
  });
  const types = properties.flatMap(entry => davChildren(entry, "prop").flatMap(prop => davChildren(prop, "resourcetype")));
  return types.length === 1 ? types[0] : undefined;
}

function parseListing(xml: string, target: string, strict: boolean): readonly DavEntry[] {
  const responses = davChildren(parseMultiStatus(xml), "response");
  // Nutstore may cap a response at 750 entries. Never rotate from a potentially incomplete list.
  if (responses.length >= 750) throw new Error("WEBDAV_LIST_LIMIT");
  const base = new URL(target);
  const expected = decodeURIComponent(base.pathname).replace(/\/$/, "");
  try {
    const entries = responses.flatMap(response => {
      const href = davChildren(response, "href")[0]?.textContent?.trim();
      if (!href) return [];
      const url = new URL(href, base);
      if (url.origin !== base.origin) return [];
      const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
      const name = path === expected ? "" : path.startsWith(expected + "/") ? path.slice(expected.length + 1) : null;
      if (name === null || name.includes("/") || name.includes("\\")) return [];

      const type = strict ? successfulResourceType(response) : response.getElementsByTagNameNS(DAV_NAMESPACE, "resourcetype").item(0);
      if (strict && (!type || davChildren(response, "href").length !== 1)) throw new Error("WEBDAV_LIST");
      const length = response.getElementsByTagNameNS(DAV_NAMESPACE, "getcontentlength").item(0)?.textContent?.trim() ?? "";
      return [{ name, directory: !!type && davChildren(type, "collection").length > 0, bytes: /^\d+$/.test(length) ? Number(length) : null }];
    });
    if (strict && (entries.length !== responses.length || new Set(entries.map(entry => entry.name)).size !== entries.length)) {
      throw new Error("WEBDAV_LIST");
    }
    return entries;
  } catch {
    throw new Error("WEBDAV_LIST");
  }
}

function signalsPartialListing(response: Response): boolean {
  if (response.status === 206 || response.headers.has("Content-Range")) return true;
  const relations = (response.headers.get("Link") ?? "").matchAll(/;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/gi);
  return Array.from(relations).some(([, quoted, token]) => (quoted ?? token ?? "").toLowerCase().split(/\s+/).includes("next"));
}

async function readBytes(response: Response, limit: number, meter: TransferMeter): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const header = response.headers.get("content-length");
  const announced = header === null ? 0 : Number(header);
  let received = 0;
  try {
    if (announced > limit) throw new Error("BACKUP_TOO_LARGE");
    if (announced > meter.remaining()) throw budgetError(announced);
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      received += chunk.value.byteLength;
      if (received > limit) throw new Error("BACKUP_TOO_LARGE");
      if (received > meter.remaining()) throw budgetError(received);
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
    await meter.downloaded(received);
  }
}

export interface WebdavClient {
  test(): Promise<void>;
  list(path: Path, strict?: boolean): Promise<readonly DavEntry[] | null>;
  hasDirectory(path: Path): Promise<boolean>;
  directory(path: Path): Promise<void>;
  get(path: Path, limit?: number): Promise<Uint8Array<ArrayBuffer> | null>;
  put(path: Path, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  move(from: Path, to: Path): Promise<"moved" | "occupied" | "missing">;
  remove(path: Path): Promise<void>;
}

export function createWebdav(settings: Pick<BackupSettings, "endpoint" | "username" | "password">, meter: TransferMeter, fetcher: typeof fetch = fetch): WebdavClient {
  const credentials = new TextEncoder().encode(`${settings.username}:${settings.password}`);
  const authorization = "Basic " + btoa(Array.from(credentials, byte => String.fromCharCode(byte)).join(""));
  const href = (path: Path, collection = false) => settings.endpoint + path.map(encodeURIComponent).join("/") + (path.length && collection ? "/" : "");

  async function request(method: string, url: string, headers: HeadersInit = {}, body?: BodyInit, size = 0, uploadSuccess: readonly number[] = []): Promise<Response> {
    const confirmUpload = await meter.start(size);
    let response: Response;
    try {
      response = await fetcher(url, {
        method, headers: { ...headers, Authorization: authorization }, body,
        redirect: "error", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(25_000)
      });
    } catch { throw new Error("WEBDAV_NETWORK"); }
    if (uploadSuccess.includes(response.status)) await confirmUpload?.();
    return response;
  }

  async function disposition(response: Response, accepted: readonly number[]): Promise<number> {
    await response.body?.cancel().catch(() => {});
    if (accepted.includes(response.status)) return response.status;
    throw new Error(`WEBDAV_HTTP_${response.status}`);
  }

  async function propfind(path: Path, depth: "0" | "1", strict = false): Promise<readonly DavEntry[] | null> {
    const url = href(path, true);
    const response = await request("PROPFIND", url, { Depth: depth, "Content-Type": "application/xml; charset=utf-8" }, properties, properties.length, [207]);
    if (strict && signalsPartialListing(response)) {
      await response.body?.cancel().catch(() => {});
      throw new Error("WEBDAV_LIST");
    }
    if (response.status !== 207) {
      await disposition(response, [404]);
      return null;
    }
    return parseListing(new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(response, 2 * MIB, meter)), url, strict);
  }

  async function hasDirectory(path: Path): Promise<boolean> {
    return (await propfind(path, "0"))?.some(entry => !entry.name && entry.directory) === true;
  }

  return {
    async test() {
      if (!await hasDirectory([])) throw new Error("WEBDAV_DIRECTORY");
    },
    hasDirectory,
    async list(path, strict) {
      const entries = await propfind(path, "1", strict);
      if (!entries) return null;
      if (!entries.some(entry => !entry.name && entry.directory)) throw new Error("WEBDAV_DIRECTORY");
      return entries.filter(entry => entry.name);
    },
    async directory(path) {
      const response = await request("MKCOL", href(path, true));
      const status = await disposition(response, [201, 405]);
      if (status === 405 && !await hasDirectory(path)) throw new Error("WEBDAV_DIRECTORY");
    },
    async get(path, limit = MAX_ARCHIVE_BYTES) {
      const response = await request("GET", href(path));
      if (response.status === 200) return readBytes(response, Math.min(limit, MAX_ARCHIVE_BYTES), meter);
      await disposition(response, [404]);
      return null;
    },
    async put(path, body, contentType) {
      const accepted = [200, 201, 204];
      await disposition(await request("PUT", href(path), { "Content-Type": contentType }, body, body.byteLength, accepted), accepted);
    },
    async move(from, to) {
      const response = await request("MOVE", href(from), { Destination: href(to), Overwrite: "F" });
      const status = await disposition(response, [201, 204, 404, 412]);
      if (status === 412) return "occupied";
      return status === 404 ? "missing" : "moved";
    },
    async remove(path) {
      await disposition(await request("DELETE", href(path)), [200, 204, 404]);
    }
  };
}
