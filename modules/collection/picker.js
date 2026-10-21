// The web overlay and extension fallback page share the same project list.
(function () {
  /** @typedef {{id:string, name:string, archived?:boolean, cover?:string}} PickerProject */
  /** @typedef {{id:string, projectId?:string|null, image?:string}} PickerItem */
  /** Build UI data from the current collection and a fixed batch snapshot.
   * @param {{laterOnProjects?:PickerProject[], laterOnItems?:PickerItem[],
   * laterOnSettings?:{language?:string, theme?:string}, laterOnCovers?:Record<string,string>}} stored
   * @param {{projectId?:string, batchId?:string, savedCount?:number, tabs?:{url:string, title?:string}[]}} payload
   * @returns {{theme:string, language:string, selected:string, batchId?:string, savedCount:number,
   * folders:{id:string, name:string, count:number, cover:string|null}[], pages:{title:string, url:string}[]}}
   */
  function buildPayload(stored, payload) {
    const projects = stored.laterOnProjects || [];
    const items = stored.laterOnItems || [];
    const settings = stored.laterOnSettings || {};
    const covers = stored.laterOnCovers || {};
    const counts = new Map();
    items.forEach((item) => {
      const id = item.projectId || "";
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    const coverFor = (projectId) => {
      const custom = projects.find((project) => project.id === projectId)?.cover;
      if (custom) return custom;
      for (const item of items.filter((entry) => (entry.projectId || "") === projectId)) {
        if (covers[item.id]) return covers[item.id];
        const image = typeof item.image === "string" ? item.image : "";
        if (image.startsWith("local://")) {
          if (covers[image.slice(8)]) return covers[image.slice(8)];
        } else if (image) return image;
      }
      return null;
    };
    const folder = (id, name) => ({
      id, name, count: counts.get(id) || 0, cover: coverFor(id)
    });
    const folders = [
      folder("", settings.language === "en" ? "Inbox" : "等待整理"),
      ...projects.filter((project) => !project.archived).map((project) => folder(project.id, project.name))
    ];
    return {
      theme: settings.theme || "light",
      language: settings.language === "en" ? "en" : "zh-CN",
      selected: folders.some((entry) => entry.id === payload.projectId) ? payload.projectId : "",
      batchId: payload.batchId,
      savedCount: payload.savedCount || 0,
      folders,
      pages: (payload.tabs || []).map((entry) => ({ title: entry.title || entry.url, url: entry.url }))
    };
  }

  globalThis.LaterOnPicker = { buildPayload };
})();
