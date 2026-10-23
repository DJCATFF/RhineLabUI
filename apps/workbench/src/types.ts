export type ViewKind = "all" | "inbox" | "recent" | "favorite" | "collection" | "tag" | "source" | "trash";
export type SortKind = "added" | "title" | "size" | "recent";
export type ViewMode = "list" | "cards";

export interface NavView {
  kind: ViewKind;
  id?: string;
}

export interface ListParams {
  view: ViewKind;
  id?: string;
  search?: string;
  kinds?: string[];
  sort?: SortKind;
  limit?: number;
  offset?: number;
}

/** 搜索命中：字段、片段与可直接用于阅读定位的位置。 */
export interface SearchHit {
  field: "title" | "tag" | "file" | "note" | "body";
  label: string;
  snippet: string;
  keyword: string;
  page: number | null;
  locator: string | null;
  offset: number;
}

export interface IndexStatus {
  indexed: number;
  total: number;
  withText: number;
  version: string | null;
  ready: boolean;
}

export interface ResourceItem {
  id: string;
  archiveNo: number;
  title: string;
  kind: string;
  status: string;
  favorite: boolean;
  inbox: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  path: string | null;
  ext: string | null;
  size: number | null;
  tags: string[];
  collectionCount: number;
  readingAt: string | null;
  readingProgress: number | null;
  /** 仅搜索响应带命中信息；普通列表为 null。 */
  hit: SearchHit | null;
}

export interface ResourceFile {
  id: string;
  storage_kind: string;
  path: string;
  mime_type: string;
  ext: string;
  size: number;
  sha256: string;
}

export interface ExtractionJob {
  id: string;
  status: string;
  attempts: number;
  error: string | null;
  updatedAt: string;
}

/** 工作进程正在抽取的资料与页码进度；没有任务在执行时为空。 */
export interface JobsProgress {
  resourceId: string;
  title: string;
  pages: number;
  pageTotal: number;
}

export interface JobsSummary {
  pending: number;
  running: number;
  failed: number;
  done: number;
  total: number;
  current?: JobsProgress | null;
}

export type ExtractTruncation = "chars" | "pages";

export interface ResourceDetail extends ResourceItem {
  note: string | null;
  summary: string | null;
  extracted: string | null;
  extractTruncated: ExtractTruncation | null;
  extractPages: number | null;
  extractPageTotal: number | null;
  files: ResourceFile[];
  collections: { id: string; name: string }[];
  tagDetails: { id: string; name: string; origin: string }[];
  reading: { locator: string; progress: number; updated_at: string } | null;
  source: { id: string; kind: string; label: string; root_path: string | null } | null;
  job: ExtractionJob | null;
}

export interface ListResult {
  items: ResourceItem[];
  total: number;
}

export interface Facets {
  all: number;
  inbox: number;
  recent: number;
  favorite: number;
  trash: number;
  collections: { id: string; name: string; n: number }[];
  tags: { id: string; name: string; n: number }[];
  sources: { id: string; label: string; kind: string; n: number }[];
}

export interface ImportProgress {
  phase: "scan" | "hash" | "save" | "done";
  index: number;
  total: number;
  current?: string;
  added?: number;
  duplicates?: number;
  repaired?: number;
  skipped?: number;
  elapsedMs?: number;
}

export interface ImportResult extends ImportProgress {
  sourceId?: string | null;
  canceled?: boolean;
}

export interface WorkspaceState {
  view: NavView;
  search: string;
  kinds: string[];
  sort: SortKind;
  mode: ViewMode;
  selectedId: string | null;
  detailOpen: boolean;
}

export const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  text: "文本",
  image: "图片",
  office: "Office",
  archive: "压缩包",
  other: "其他",
};

export const KIND_FILTERS = ["pdf", "text", "image", "office", "archive", "other"] as const;

/** 正文抽取状态；resources.status 只有可抽取类型才会离开 ready。 */
export const STATUS_LABEL: Record<string, string> = {
  pending: "待抽取",
  processing: "抽取中",
  ready: "可检索",
  failed: "抽取失败",
};

export function isReadable(kind: string): boolean {
  return kind === "pdf" || kind === "text" || kind === "image";
}

/** 与桌面端抽取器保持一致：只有纯文本与 PDF 会进入正文抽取流程。 */
export function isExtractableKind(kind: string): boolean {
  return kind === "pdf" || kind === "text";
}
