interface DiscourseSite {
  readonly origin: string;
  readonly basePath: string;
}

export interface DiscourseTopic extends DiscourseSite {
  readonly topicId: string;
}

export function discourseTopicId(url: string, site: DiscourseSite): string | null {
  try {
    const { origin, pathname, hash } = new URL(url);
    const prefix = `${site.basePath}/t/`;
    if (origin !== site.origin || !pathname.startsWith(prefix) || /^#!?\//.test(hash)) return null;

    const route = pathname.slice(prefix.length);
    const shortRoute = /^(\d+)(?:\/\d+)?\/?$/.exec(route);
    const slugRoute = /^(?!(?:id_for|external_id)\/)[^/]+\/(\d+)(?:\/\d+)?\/?$/;
    const topicId = shortRoute?.[1] ?? slugRoute.exec(route)?.[1];
    return topicId?.replace(/^0+/, "") || null;
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
    const topicId = discourseTopicId(url, site);
    return topicId ? { ...site, topicId } : undefined;
  } catch {
    return undefined;
  }
}
