import { computed, reactive, shallowRef } from "vue";
import { boardGroups, collectionCards, projectNavigation } from "./shared";
import type { CardOrders, LibraryCollection } from "./shared";
import type { ReadFilter, SortMode } from "../collection/filter";
import { t } from "../shared/i18n";
import type { StoredSettings } from "../settings/shared";

export function useLibraryView() {
  const collection = shallowRef<LibraryCollection>({ items: [], projects: [], covers: {} });
  const orders = shallowRef<CardOrders>({});
  const preferences = shallowRef<StoredSettings>({});
  const state = reactive({ filter: "unread" as ReadFilter, search: "", query: "", sort: "newest" as SortMode,
    selecting: false, activeProject: "all", renamingId: null as string | null, renameDraft: "", currentItemId: null as string | null,
    // 总览展示项目图板；搜索要找文章，因此有关键词时直接进入卡片列表。
    get board(): boolean { return ["all", "archive"].includes(this.activeProject) && !this.query; },
    get count(): string {
      const list = this.query ? cardView.value.visible : cardView.value.scoped;
      return t(this.query ? "searchCount" : "scopedCount", { count: list.length, unfinished: list.filter(item => item.status !== "done").length });
    },
    get empty(): boolean { return !cardView.value.visible.length; },
    get emptyTitle(): string { return collection.value.items.length ? "noMatches" : "quiet"; },
    get emptyHint(): string { return collection.value.items.length ? "noMatchesHint" : "quietHint"; }
  });
  const cardView = computed(() => collectionCards(collection.value, state, orders.value));
  const cards = computed(() => state.board ? [] : cardView.value.visible);
  const navigation = computed(() => projectNavigation(collection.value));
  const boards = computed(() => boardGroups(collection.value, state.filter, state.activeProject === "archive"));
  const boardSummary = computed(() => ({ groups: boards.value.length,
    total: boards.value.reduce((sum, group) => sum + group.items.length, 0),
    unfinished: boards.value.reduce((sum, group) => sum + group.items.filter(item => item.status !== "done").length, 0) }));
  const unfiled = computed(() => collection.value.items.filter(item => !item.projectId).length);
  const total = computed(() => collection.value.items.filter(item => !collection.value.projects.some(project => project.id === item.projectId && project.archived)).length);
  return { state, collection, orders, preferences, cardView, cards, navigation, boards, boardSummary, unfiled, total };
}

export type LibraryView = ReturnType<typeof useLibraryView>;
