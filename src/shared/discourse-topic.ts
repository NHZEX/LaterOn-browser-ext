interface DiscourseSite {
  readonly origin: string;
  readonly basePath: string;
}

interface DiscourseLocation {
  readonly topicId: string;
  readonly postNumber: string | null;
}

export interface DiscourseTopic extends DiscourseSite, DiscourseLocation {}

export function discourseLocation(url: string, site: DiscourseSite): DiscourseLocation | null {
  try {
    const { origin, pathname, hash } = new URL(url);
    const prefix = `${site.basePath}/t/`;
    if (origin !== site.origin || !pathname.startsWith(prefix) || /^#!?\//.test(hash)) return null;

    const route = pathname.slice(prefix.length);
    const parts = /^(\d+)(?:\/(\d+))?\/?$/.exec(route)
      ?? /^(?!(?:id_for|external_id)\/)[^/]+\/(\d+)(?:\/(\d+))?\/?$/.exec(route);
    const topicId = parts?.[1]?.replace(/^0+/, "");
    const postNumber = parts?.[2]?.replace(/^0+/, "") ?? null;
    return topicId && postNumber !== "" ? { topicId, postNumber } : null;
  } catch {
    return null;
  }
}

export function identifyDiscourseTopic(url: string, baseUrl: string, baseUri: string): DiscourseTopic | undefined {
  try {
    const base = new URL(baseUrl);
    const basePath = baseUri.replace(/\/$/, "");
    if (!/^https?:$/.test(base.protocol) || base.search || base.hash || base.username || base.password ||
      base.pathname.replace(/\/$/, "") !== basePath) return;
    const site = { origin: base.origin, basePath };
    const location = discourseLocation(url, site);
    return location ? { ...site, ...location } : undefined;
  } catch {
    return undefined;
  }
}
