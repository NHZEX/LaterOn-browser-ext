<script setup lang="ts">
import { computed } from "vue";
import type { LibraryControls } from "../../../src/library/useLibraryControls";
import type { Translate } from "../../../src/shared/i18n";
import ProjectRow from "./ProjectRow.vue";

const props = defineProps<{ controls: LibraryControls; translate: Translate }>();
const pinCount = computed(() => props.controls.navigation.value.filter(project => project.pinned).length);
function unfiled(): void { props.controls.project("unfiled"); }
function all(): void { props.controls.project("all"); }
function archive(): void { props.controls.project("archive"); }
</script>

<template>
  <button class="project-nav inbox-card" :class="{ active: controls.state.activeProject === 'unfiled', 'has-items': controls.unfiled.value > 0 }" data-project="unfiled" @click="unfiled">
    <span class="inbox-icon">
      <!-- 用户提供的收藏夹图标：重绘为真正的矢量路径，以便跟随 currentColor。 -->
      <svg class="nav-art-icon" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <mask id="lateron-favorites-front">
            <rect width="24" height="24" fill="#000"/>
            <path d="M3 10.4h5.1l1.55 1.75h9.1A2.25 2.25 0 0 1 21 14.4v4.15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18.55Z" fill="#fff"/>
            <path d="m12 13.2.94 1.9 2.1.3-1.52 1.48.36 2.1L12 18l-1.88.98.36-2.1-1.52-1.48 2.1-.3Z" fill="#000"/>
          </mask>
        </defs>
        <path d="M6.1 3.4h4.15l1.4 1.55h6.2a1.8 1.8 0 0 1 1.8 1.8v8.1H6.1Z" opacity=".28"/>
        <path d="M4.45 6.7H8.7l1.45 1.6h6.7a1.9 1.9 0 0 1 1.9 1.9v7H4.45Z" opacity=".5"/>
        <rect width="24" height="24" mask="url(#lateron-favorites-front)"/>
      </svg>
    </span>
    <span class="inbox-body">
      <strong class="inbox-title">{{ translate('inbox') }}</strong>
      <small class="inbox-hint">{{ controls.unfiled.value ? translate('inboxPending', { n: controls.unfiled.value }) : translate('noInbox') }}</small>
    </span>
    <span class="inbox-count" id="unfiledCount">{{ controls.unfiled.value }}</span>
  </button>
  <button class="project-nav top-entry" :class="{ active: controls.state.activeProject === 'all' }" data-project="all" @click="all">
    <span class="nav-icon all-icon">
      <!-- 用户提供的三列项目面板：保留层次明暗，颜色跟随 currentColor。 -->
      <svg class="nav-art-icon" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <mask id="lateron-project-columns">
            <rect width="24" height="24" fill="#000"/>
            <rect x="2.3" y="3" width="5.7" height="18" rx="1.8" fill="#fff"/>
            <rect x="9.15" y="3" width="5.7" height="18" rx="1.8" fill="#fff"/>
            <rect x="16" y="3" width="5.7" height="18" rx="1.8" fill="#fff"/>
            <rect x="3.45" y="5.15" width="3.4" height="1.55" rx=".78" fill="#000"/>
            <rect x="3.45" y="8.1" width="3.4" height="1.55" rx=".78" fill="#000"/>
            <rect x="3.55" y="12.2" width="3.2" height="5.9" rx="1.15" fill="#000" opacity=".42"/>
            <rect x="10.3" y="5.15" width="3.4" height="1.55" rx=".78" fill="#000"/>
            <rect x="10.3" y="8.1" width="3.4" height="1.55" rx=".78" fill="#000"/>
            <rect x="10.4" y="12.2" width="3.2" height="5.9" rx="1.15" fill="#000" opacity=".42"/>
            <rect x="17.15" y="5.15" width="3.4" height="1.55" rx=".78" fill="#000"/>
            <rect x="17.15" y="8.1" width="3.4" height="1.55" rx=".78" fill="#000"/>
            <rect x="17.25" y="12.2" width="3.2" height="5.9" rx="1.15" fill="#000" opacity=".42"/>
          </mask>
        </defs>
        <g mask="url(#lateron-project-columns)">
          <rect x="2.3" y="3" width="5.7" height="18" rx="1.8"/>
          <rect x="9.15" y="3" width="5.7" height="18" rx="1.8" opacity=".52"/>
          <rect x="16" y="3" width="5.7" height="18" rx="1.8" opacity=".3"/>
        </g>
      </svg>
    </span>
    <span>{{ translate('allProjectsOverview') }}</span><strong class="nav-count" id="allCount">{{ controls.total.value }}</strong>
  </button>
  <div class="projects-section is-visible">
    <div id="projectList" class="project-list">
      <template v-for="(project, index) in controls.navigation.value" :key="project.id">
        <ProjectRow :project="project" :controls="controls" :translate="translate" />
        <div v-if="pinCount && index === pinCount - 1 && controls.navigation.value.length> pinCount" class="project-pin-sep" role="separator" :aria-label="translate('pinnedProjects')"></div>
      </template>
    </div>
  </div>
  <div class="sidebar-footer">
    <button id="openArchive" class="sidebar-setting" :class="{ active: controls.state.activeProject === 'archive' }" type="button" @click="archive"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v4H3zM5 8v12h14V8M9 12h6" /></svg><span>{{ translate('archive') }}</span></button>
    <button id="openSettings" class="sidebar-setting" type="button" :title="translate('settings')" :aria-label="translate('settings')" @click="controls.settings">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      <span>{{ translate('settings') }}</span>
    </button>
    <p class="sidebar-slogan">{{ translate('slogan') }}</p>
  </div>
  <!-- Vue owns stable markup; useSidebarWidth owns resize listeners and their cleanup. -->
  <div id="sidebarResizer" class="sidebar-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="projectSidebar"
    :aria-label="translate('resizeSidebar')" :title="translate('resizeSidebarHint')"></div>
  <div id="sidebarSizeControls" class="sidebar-size-controls" role="group" :aria-label="translate('resizeSidebar')" hidden>
    <button type="button" data-sidebar-size="narrower" :title="translate('narrowSidebar')" :aria-label="translate('narrowSidebar')">−</button>
    <button type="button" data-sidebar-size="wider" :title="translate('widenSidebar')" :aria-label="translate('widenSidebar')">+</button>
    <button type="button" data-sidebar-size="reset" :title="translate('resetSidebar')">{{ translate('resetSidebar') }}</button>
  </div>
</template>
