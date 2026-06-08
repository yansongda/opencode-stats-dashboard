<template>
  <div class="view-container" data-testid="sessions-view">
    <h1 class="view-title">会话列表</h1>

    <!-- Loading State -->
    <LoadingState v-if="loading" message="加载会话数据中..." test-id="sessions-loading" />

    <!-- Error State -->
    <EmptyState
      v-else-if="error"
      variant="error"
      title="数据加载失败"
      :description="error"
      action-label="重试"
      test-id="sessions-error"
      @action="store.refreshData"
    />

    <!-- Content -->
    <template v-else>
    <!-- Filter Bar -->
    <div class="filter-bar resp-filter-bar">
      <input
        v-model="searchQuery"
        type="text"
        class="filter-input filter-search"
        placeholder="搜索会话 ID、项目、标题..."
        data-testid="filter-search"
      />
      <select v-model="filterStatus" class="filter-select" data-testid="filter-status">
        <option value="all">全部状态</option>
        <option value="active">活跃</option>
        <option value="deleted">已删除</option>
      </select>
      <select v-model="filterModel" class="filter-select" data-testid="filter-model">
        <option value="all">全部模型</option>
        <option v-for="m in uniqueModels" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filterProject" class="filter-select" data-testid="filter-project">
        <option value="all">全部项目</option>
        <option v-for="p in uniqueProjects" :key="p" :value="p">{{ truncateProject(p) }}</option>
      </select>
      <input
        v-model="dateFrom"
        type="date"
        class="filter-input filter-date"
        data-testid="filter-date-from"
      />
      <span class="filter-sep">至</span>
      <input
        v-model="dateTo"
        type="date"
        class="filter-input filter-date"
        data-testid="filter-date-to"
      />
      <button class="btn btn-ghost" data-testid="filter-reset" @click="resetFilters">重置</button>
    </div>

    <!-- Summary Bar -->
    <div class="summary-bar">
      <span class="summary-total">共 {{ filteredSessions.length }} 会话</span>
      <span class="summary-sep">|</span>
      <span class="summary-active">{{ activeCount }} 活跃</span>
      <span class="summary-sep">|</span>
      <span class="summary-deleted">{{ deletedCount }} 已删除</span>
    </div>

    <!-- Data Table -->
    <div class="table-wrapper resp-table-wrapper">
      <table class="data-table" data-testid="sessions-table">
        <thead>
          <tr>
            <th
              class="col-session-id sortable"
              :class="{ sorted: sortKey === 'session_id' }"
              @click="toggleSort('session_id')"
            >
              会话 ID
              <span class="sort-indicator">{{ sortIndicator('session_id') }}</span>
            </th>
            <th class="col-title">标题</th>
            <th
              class="col-project sortable"
              :class="{ sorted: sortKey === 'project_path' }"
              @click="toggleSort('project_path')"
            >
              项目
              <span class="sort-indicator">{{ sortIndicator('project_path') }}</span>
            </th>
            <th
              class="col-model sortable"
              :class="{ sorted: sortKey === 'primary_model' }"
              @click="toggleSort('primary_model')"
            >
              模型
              <span class="sort-indicator">{{ sortIndicator('primary_model') }}</span>
            </th>
            <th
              class="col-tokens sortable"
              :class="{ sorted: sortKey === 'total_tokens' }"
              @click="toggleSort('total_tokens')"
            >
              Token
              <span class="sort-indicator">{{ sortIndicator('total_tokens') }}</span>
            </th>
            <th
              class="col-cost sortable"
              :class="{ sorted: sortKey === 'total_cost_usd' }"
              @click="toggleSort('total_cost_usd')"
            >
              成本
              <span class="sort-indicator">{{ sortIndicator('total_cost_usd') }}</span>
            </th>
            <th class="col-status">状态</th>
            <th
              class="col-date sortable"
              :class="{ sorted: sortKey === 'last_event_at' }"
              @click="toggleSort('last_event_at')"
            >
              最后活跃
              <span class="sort-indicator">{{ sortIndicator('last_event_at') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="session in paginatedSessions"
            :key="session.session_id"
            :class="{
              'row-deleted': session.status === 'deleted',
              'row-selected': selectedSessionId === session.session_id,
            }"
            class="clickable-row"
            :data-testid="`session-row-${session.session_id}`"
            @click="selectSession(session.session_id)"
          >
            <td class="col-session-id">
              <span class="session-id-truncated" :title="session.session_id">
                {{ truncateSessionId(session.session_id) }}
              </span>
            </td>
            <td class="col-title" :title="session.title ?? ''">
              {{ session.title ?? '—' }}
            </td>
            <td class="col-project" :title="session.project_path ?? ''">
              {{ truncateProject(session.project_path ?? '—') }}
            </td>
            <td class="col-model">{{ session.primary_model ?? '—' }}</td>
            <td class="col-tokens">{{ formatNumber(session.total_tokens) }}</td>
            <td class="col-cost">{{ formatCost(session.total_cost_usd) }}</td>
            <td class="col-status">
              <StatusBadge :status="session.status" />
            </td>
            <td class="col-date">{{ formatTimestamp(session.last_event_at) }}</td>
          </tr>
          <tr v-if="paginatedSessions.length === 0">
            <td colspan="8" class="empty-state">没有匹配当前过滤条件的会话</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination-bar" data-testid="pagination">
      <span class="pagination-info">
        显示 {{ paginationStart }}–{{ paginationEnd }} / 共 {{ filteredSessions.length }} 条
      </span>
      <div class="pagination-controls">
        <button
          class="btn btn-ghost btn-sm"
          :disabled="currentPage === 1"
          data-testid="page-prev"
          @click="currentPage--"
        >
          上一页
        </button>
        <button
          v-for="page in visiblePages"
          :key="page"
          class="btn btn-sm"
          :class="page === currentPage ? 'btn-primary' : 'btn-ghost'"
          @click="currentPage = page"
        >
          {{ page }}
        </button>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="currentPage >= totalPages"
          data-testid="page-next"
          @click="currentPage++"
        >
          下一页
        </button>
      </div>
    </div>

    <!-- Session Detail Panel -->
    <div v-if="detailLoading" class="detail-panel" data-testid="session-detail-loading">
      <div class="detail-loading">加载中...</div>
    </div>
    <div v-else-if="selectedDetail" class="detail-panel" data-testid="session-detail">
      <div class="detail-header">
        <h2 class="detail-title">
          会话详情
          <code class="detail-session-id">{{ selectedDetail.session_id }}</code>
        </h2>
        <button class="btn btn-ghost btn-sm" @click="selectedSessionId = null">关闭</button>
      </div>

      <!-- Basic Info -->
      <div class="detail-section">
        <h3 class="detail-section-title">基本信息</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">标题</span>
            <span class="detail-value">{{ selectedDetail.title ?? '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">项目</span>
            <span class="detail-value" :title="selectedDetail.project_path ?? ''">{{ truncateProject(selectedDetail.project_path ?? '—') }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">模型</span>
            <span class="detail-value">{{ selectedDetail.primary_model ?? '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">状态</span>
            <span class="detail-value"><StatusBadge :status="selectedDetail.status" /></span>
          </div>
          <div class="detail-item">
            <span class="detail-label">时长</span>
            <span class="detail-value">{{ formatDuration(selectedDetail.duration_ms) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">事件数</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.event_count) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">首次事件</span>
            <span class="detail-value">{{ formatTimestamp(selectedDetail.first_event_at) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">末次事件</span>
            <span class="detail-value">{{ formatTimestamp(selectedDetail.last_event_at) }}</span>
          </div>
        </div>
      </div>

      <!-- Token Stats -->
      <div class="detail-section">
        <h3 class="detail-section-title">Token 统计</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">总计</span>
            <span class="detail-value detail-value-highlight">{{ formatNumber(selectedDetail.total_tokens) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">输入</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.input_tokens) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">输出</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.output_tokens) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">推理</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.reasoning_tokens) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">缓存读</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.cache_read) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">缓存写</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.cache_write) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">成本</span>
            <span class="detail-value detail-value-highlight">{{ formatCost(selectedDetail.total_cost_usd) }}</span>
          </div>
        </div>
      </div>

      <!-- Messages & Tools -->
      <div class="detail-section">
        <h3 class="detail-section-title">消息 & 工具</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">用户消息</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.user_message_count) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">助手消息</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.assistant_message_count) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">工具调用</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.tool_call_count) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">工具错误</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.tool_error_count) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">文件编辑</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.files_edited) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">代码变更</span>
            <span class="detail-value">+{{ formatNumber(selectedDetail.lines_added) }} / -{{ formatNumber(selectedDetail.lines_deleted) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">错误数</span>
            <span class="detail-value">{{ formatNumber(selectedDetail.error_count) }}</span>
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, h } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import { useStatsStore } from '../stores/stats'
import {
  fetchStatsSessionDetail,
  type StatsSessionListItem,
  type SessionDetail,
} from '../api/client'

// ── Store ──────────────────────────────────────────────────────────────

const store = useStatsStore()

// ── Data (from global store, auto-updates via SSE) ─────────────────────

const allSessions = computed<StatsSessionListItem[]>(() => store.sessions.value)
const loading = computed(() => store.loading.value)
const error = computed(() => store.error.value)

// ── Filters ──────────────────────────────────────────────────────────

const searchQuery = ref('')
const filterStatus = ref<'all' | 'active' | 'deleted'>('all')
const filterModel = ref('all')
const filterProject = ref('all')
const dateFrom = ref('')
const dateTo = ref('')

// ── Sorting ──────────────────────────────────────────────────────────

type SortKey = 'session_id' | 'project_path' | 'primary_model' | 'total_tokens' | 'total_cost_usd' | 'last_event_at'
const sortKey = ref<SortKey>('last_event_at')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'total_tokens' || key === 'total_cost_usd' ? 'desc' : 'asc'
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

// ── Derived Data ─────────────────────────────────────────────────────

const uniqueModels = computed(() => {
  const models = new Set<string>()
  for (const s of allSessions.value) {
    if (s.primary_model) models.add(s.primary_model)
  }
  return [...models].sort()
})

const uniqueProjects = computed(() => {
  const projects = new Set<string>()
  for (const s of allSessions.value) {
    if (s.project_path) projects.add(s.project_path)
  }
  return [...projects].sort()
})

const filteredSessions = computed<StatsSessionListItem[]>(() => {
  let list = [...allSessions.value]

  // Status filter
  if (filterStatus.value !== 'all') {
    list = list.filter((s) => s.status === filterStatus.value)
  }

  // Model filter
  if (filterModel.value !== 'all') {
    list = list.filter((s) => s.primary_model === filterModel.value)
  }

  // Project filter
  if (filterProject.value !== 'all') {
    list = list.filter((s) => s.project_path === filterProject.value)
  }

  // Search filter
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(
      (s) =>
        s.session_id.toLowerCase().includes(q) ||
        (s.project_path ?? '').toLowerCase().includes(q) ||
        (s.title ?? '').toLowerCase().includes(q),
    )
  }

  // Date range filter (based on last_event_at, which is ms timestamp)
  if (dateFrom.value) {
    const from = new Date(dateFrom.value).getTime()
    list = list.filter((s) => {
      if (s.last_event_at == null) return false
      return s.last_event_at >= from
    })
  }
  if (dateTo.value) {
    const to = new Date(dateTo.value).getTime() + 86400000 // end of day
    list = list.filter((s) => {
      if (s.last_event_at == null) return false
      return s.last_event_at <= to
    })
  }

  // Sort
  list.sort((a, b) => {
    const aVal = a[sortKey.value]
    const bVal = b[sortKey.value]
    let cmp = 0
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal
    } else {
      cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''))
    }
    return sortDir.value === 'asc' ? cmp : -cmp
  })

  return list
})

const activeCount = computed(() => filteredSessions.value.filter((s) => s.status === 'active').length)
const deletedCount = computed(() => filteredSessions.value.filter((s) => s.status === 'deleted').length)

// ── Pagination ───────────────────────────────────────────────────────

const PAGE_SIZE = 50
const currentPage = ref(1)

// Reset page when filters change
watch([searchQuery, filterStatus, filterModel, filterProject, dateFrom, dateTo], () => {
  currentPage.value = 1
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredSessions.value.length / PAGE_SIZE)))

const paginationStart = computed(() =>
  filteredSessions.value.length === 0 ? 0 : (currentPage.value - 1) * PAGE_SIZE + 1,
)
const paginationEnd = computed(() =>
  Math.min(currentPage.value * PAGE_SIZE, filteredSessions.value.length),
)

const paginatedSessions = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredSessions.value.slice(start, start + PAGE_SIZE)
})

const visiblePages = computed(() => {
  const pages: number[] = []
  const total = totalPages.value
  const current = currentPage.value
  const start = Math.max(1, current - 2)
  const end = Math.min(total, current + 2)
  for (let i = start; i <= end; i++) {
    pages.push(i)
  }
  return pages
})

// ── Session Detail ───────────────────────────────────────────────────

const selectedSessionId = ref<string | null>(null)
const selectedDetail = ref<SessionDetail | null>(null)
const detailLoading = ref(false)

async function selectSession(sessionId: string): Promise<void> {
  if (selectedSessionId.value === sessionId) {
    selectedSessionId.value = null
    selectedDetail.value = null
    return
  }
  selectedSessionId.value = sessionId
  detailLoading.value = true
  try {
    selectedDetail.value = await fetchStatsSessionDetail(sessionId)
  } catch {
    selectedDetail.value = null
  } finally {
    detailLoading.value = false
  }
}

// ── Actions ──────────────────────────────────────────────────────────

function resetFilters(): void {
  searchQuery.value = ''
  filterStatus.value = 'all'
  filterModel.value = 'all'
  filterProject.value = 'all'
  dateFrom.value = ''
  dateTo.value = ''
}

// ── Formatters ───────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

function truncateProject(path: string): string {
  if (path.length <= 30) return path
  return '…' + path.slice(-28)
}

function truncateSessionId(id: string): string {
  if (id.length <= 16) return id
  return id.slice(0, 12) + '…'
}

function formatTimestamp(ms: number | null): string {
  if (ms == null) return '—'
  const date = new Date(ms)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}秒`
  const min = Math.floor(sec / 60)
  const remainSec = sec % 60
  if (min < 60) return `${min}分${remainSec}秒`
  const hour = Math.floor(min / 60)
  const remainMin = min % 60
  return `${hour}时${remainMin}分`
}

// ── StatusBadge Component ─────────────────────────────────────────────

const StatusBadge = {
  props: {
    status: { type: String, required: true },
  },
  setup(props: { status: string }) {
    return () => {
      const isActive = props.status === 'active'
      return h(
        'span',
        {
          class: ['status-badge', isActive ? 'badge-active' : 'badge-deleted'],
        },
        isActive ? '活跃' : '已删除',
      )
    }
  },
}
</script>

<style scoped>
/* ── View Container ─────────────────────────────────────────────────── */

.view-container {
  padding: var(--spacing-6);
  max-width: 100%;
}

.view-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  margin-bottom: var(--spacing-4);
  color: var(--text);
}

/* ── Filter Bar ─────────────────────────────────────────────────────── */

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2);
  align-items: center;
  padding: var(--spacing-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-3);
}

.filter-input,
.filter-select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--text-base);
  outline: none;
  transition: border-color 0.15s ease;
}

.filter-input:focus,
.filter-select:focus {
  border-color: var(--primary);
}

.filter-search {
  min-width: 200px;
  flex: 1;
}

.filter-date {
  width: 140px;
}

.filter-sep {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* ── Summary Bar ────────────────────────────────────────────────────── */

.summary-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-bottom: var(--spacing-2);
}

.summary-total {
  color: var(--text);
  font-weight: 500;
}

.summary-active {
  color: var(--success);
}

.summary-deleted {
  color: var(--danger);
}

.summary-sep {
  opacity: 0.4;
}

/* ── Data Table ─────────────────────────────────────────────────────── */

.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.data-table thead {
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 1;
}

.data-table th {
  padding: var(--spacing-2) var(--spacing-3);
  text-align: left;
  font-weight: 500;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}

.data-table th.sortable {
  cursor: pointer;
  transition: color 0.15s ease;
}

.data-table th.sortable:hover {
  color: var(--text);
}

.data-table th.sorted {
  color: var(--primary);
}

.sort-indicator {
  font-size: var(--text-xs);
  margin-left: var(--spacing-1);
  opacity: 0.6;
}

.data-table td {
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: middle;
}

.data-table tbody tr {
  transition: background-color 0.1s ease;
}

.data-table tbody tr.clickable-row {
  cursor: pointer;
}

.data-table tbody tr.clickable-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* Deleted row highlight */
.data-table tbody tr.row-deleted {
  background: rgba(239, 68, 68, 0.05);
}

.data-table tbody tr.row-deleted:hover {
  background: rgba(239, 68, 68, 0.08);
}

/* Selected row highlight */
.data-table tbody tr.row-selected {
  background: rgba(59, 130, 246, 0.08);
}

.data-table tbody tr.row-selected:hover {
  background: rgba(59, 130, 246, 0.12);
}

/* Column widths */
.col-session-id {
  min-width: 130px;
}

.col-title {
  min-width: 120px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-project {
  min-width: 150px;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-model {
  min-width: 80px;
}

.col-tokens,
.col-cost {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.col-status {
  text-align: center;
  width: 80px;
}

.col-date {
  white-space: nowrap;
  min-width: 100px;
}

.session-id-truncated {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
  color: var(--primary);
  background: rgba(59, 130, 246, 0.08);
  padding: 1px var(--spacing-1);
  border-radius: var(--radius-sm);
  cursor: help;
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-6) !important;
  font-style: italic;
}

/* ── Status Badge ───────────────────────────────────────────────────── */

:deep(.status-badge) {
  display: inline-block;
  padding: 1px var(--spacing-2);
  border-radius: var(--radius-lg);
  font-size: var(--text-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

:deep(.badge-active) {
  color: var(--success);
  background: rgba(34, 197, 94, 0.12);
}

:deep(.badge-deleted) {
  color: var(--danger);
  background: rgba(239, 68, 68, 0.12);
}

/* ── Pagination ─────────────────────────────────────────────────────── */

.pagination-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-3) 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.pagination-controls {
  display: flex;
  gap: var(--spacing-1);
}

/* ── Detail Panel ───────────────────────────────────────────────────── */

.detail-panel {
  margin-top: var(--spacing-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.detail-loading {
  padding: var(--spacing-6);
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.detail-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.detail-session-id {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
  color: var(--primary);
  background: rgba(59, 130, 246, 0.08);
  padding: 1px var(--spacing-2);
  border-radius: var(--radius-sm);
}

.detail-section {
  padding: var(--spacing-3) var(--spacing-4);
  border-bottom: 1px solid var(--border);
}

.detail-section:last-child {
  border-bottom: none;
}

.detail-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing-2);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--spacing-2) var(--spacing-4);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.detail-value {
  font-size: var(--text-base);
  color: var(--text);
}

.detail-value-highlight {
  font-weight: 600;
  color: var(--primary);
}

/* ── Shared Button Styles ───────────────────────────────────────────── */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--surface);
  color: var(--text);
}

.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-ghost {
  background: transparent;
  border-color: transparent;
}

.btn-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.btn-sm {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--text-sm);
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 767px) {
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-search,
  .filter-select,
  .filter-date {
    width: 100%;
  }

  .pagination-bar {
    flex-direction: column;
    gap: var(--spacing-2);
  }

  .detail-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}
</style>
