import type { Facets, NavView, SortKind, ViewMode, WorkspaceState } from "./types";

const KEY = "rhine.workbench.v1";

export const DEFAULT_WORKSPACE: WorkspaceState = {
  view: { kind: "all" },
  search: "",
  kinds: [],
  sort: "added",
  mode: "list",
  selectedId: null,
  detailOpen: true,
};

export function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_WORKSPACE;
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    return {
      view: parsed.view ?? { kind: "all" },
      search: parsed.search ?? "",
      kinds: Array.isArray(parsed.kinds) ? parsed.kinds : [],
      sort: (parsed.sort as SortKind) ?? "added",
      mode: (parsed.mode as ViewMode) ?? "list",
      selectedId: parsed.selectedId ?? null,
      detailOpen: parsed.detailOpen ?? true,
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 忽略存储失败，工作台仍可继续使用
  }
}

function facetName(view: NavView, facets: Facets | undefined): string | null {
  if (!facets || !view.id) return null;
  if (view.kind === "collection") return facets.collections.find((item) => item.id === view.id)?.name ?? null;
  if (view.kind === "tag") return facets.tags.find((item) => item.id === view.id)?.name ?? null;
  if (view.kind === "source") return facets.sources.find((item) => item.id === view.id)?.label ?? null;
  return null;
}

export function viewTitle(view: NavView, facets: Facets | undefined): string {
  switch (view.kind) {
    case "inbox":
      return "收件箱";
    case "recent":
      return "最近阅读";
    case "favorite":
      return "收藏";
    case "collection":
      return facetName(view, facets) ?? "集合";
    case "tag":
      return facetName(view, facets) ?? "标签";
    case "source":
      return facetName(view, facets) ?? "来源";
    case "trash":
      return "回收站";
    default:
      return "全部资源";
  }
}

export function viewHint(view: NavView): string {
  switch (view.kind) {
    case "inbox":
      return "新导入的资料先到这里，确认后再归入集合";
    case "recent":
      return "按最近阅读顺序排列";
    case "favorite":
      return "标记过的资料会一直留在这里";
    case "trash":
      return "删除的资料可以恢复，原件不会被移走";
    case "collection":
      return "属于该集合的资料，可以同时属于多个集合";
    case "tag":
      return "跨项目使用的主题标签";
    case "source":
      return "来自同一文件夹或存储位置的资料";
    default:
      return "资料库中的全部条目";
  }
}

export const SORT_LABEL: Record<SortKind, string> = {
  added: "按添加时间",
  recent: "按最近阅读",
  title: "按标题",
  size: "按文件大小",
};
