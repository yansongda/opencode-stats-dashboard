<template>
  <div class="view-container">
    <h1>工具调用</h1>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <input
        v-model="searchQuery"
        type="text"
        class="filter-input"
        placeholder="搜索工具名、会话 ID..."
        data-testid="filter-search"
      />
      <select v-model="selectedTool" class="filter-select" data-testid="filter-tool">
        <option value="">全部工具</option>
        <option v-for="tool in toolOptions" :key="tool" :value="tool">{{ tool }}</option>
      </select>
      <select v-model="selectedStatus" class="filter-select" data-testid="filter-status">
        <option value="">全部状态</option>
        <option value="completed">已完成</option>
        <option value="running">进行中</option>
        <option value="failed">失败</option>
      </select>
      <select v-model="selectedSession" class="filter-select" data-testid="filter-session">
        <option value="">全部会话</option>
        <option v-for="sid in sessionOptions" :key="sid" :value="sid">{{ sid }}</option>
      </select>
      <input
        v-model="dateFrom"
        type="date"
        class="filter-date"
        data-testid="filter-date-from"
      />
      <input
        v-model="dateTo"
        type="date"
        class="filter-date"
        data-testid="filter-date-to"
      />
      <button class="filter-reset" data-testid="filter-reset" @click="resetFilters">
        重置
      </button>
    </div>

    <!-- Summary Bar -->
    <div class="summary-bar">
      <span>共 {{ filteredCalls.length }} 次调用</span>
      <span class="summary-sep">|</span>
      <span class="summary-success">{{ statusCount('completed') }} 成功</span>
      <span class="summary-sep">|</span>
      <span class="summary-running">{{ statusCount('running') }} 进行中</span>
      <span class="summary-sep">|</span>
      <span class="summary-failed">{{ statusCount('failed') }} 失败</span>
    </div>

    <!-- Data Table -->
    <div class="table-wrapper">
      <table class="data-table" data-testid="tool-calls-table">
        <thead>
          <tr>
            <th class="col-sortable" @click="toggleSort('tool_name')">
              工具名 <span class="sort-arrow">{{ sortIndicator('tool_name') }}</span>
            </th>
            <th class="col-sortable" @click="toggleSort('session_id')">
              会话 ID <span class="sort-arrow">{{ sortIndicator('session_id') }}</span>
            </th>
            <th class="col-sortable col-center" @click="toggleSort('status')">
              状态 <span class="sort-arrow">{{ sortIndicator('status') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('tokens')">
              代币 <span class="sort-arrow">{{ sortIndicator('tokens') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('cost_usd')">
              成本 <span class="sort-arrow">{{ sortIndicator('cost_usd') }}</span>
            </th>
            <th class="col-sortable" @click="toggleSort('started_at')">
              开始时间 <span class="sort-arrow">{{ sortIndicator('started_at') }}</span>
            </th>
            <th class="col-sortable" @click="toggleSort('completed_at')">
              完成时间 <span class="sort-arrow">{{ sortIndicator('completed_at') }}</span>
            </th>
            <th>摘要</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="paginatedCalls.length === 0">
            <td colspan="8" class="empty-row">暂无数据</td>
          </tr>
          <tr v-for="call in paginatedCalls" :key="call.id">
            <td class="col-monospace">{{ call.tool_name }}</td>
            <td class="col-monospace">{{ truncateId(call.session_id) }}</td>
            <td class="col-center">
              <span class="audit-badge" :class="badgeClass(call.status)">
                {{ badgeLabel(call.status) }}
              </span>
            </td>
            <td class="col-right">{{ call.tokens != null ? formatNumber(call.tokens) : '—' }}</td>
            <td class="col-right">{{ call.cost_usd != null ? formatCost(call.cost_usd) : '—' }}</td>
            <td>{{ formatInTimezone(call.started_at) }}</td>
            <td>{{ formatInTimezone(call.completed_at) }}</td>
            <td class="col-summary" :title="call.summary || ''">{{ call.summary || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination">
      <span class="pagination-info">
        显示 {{ paginationStart }}-{{ paginationEnd }} / 共 {{ filteredCalls.length }} 条
      </span>
      <div class="pagination-controls">
        <button
          class="page-btn"
          :disabled="currentPage <= 1"
          data-testid="page-prev"
          @click="currentPage--"
        >
          上一页
        </button>
        <button
          v-for="page in visiblePages"
          :key="page"
          class="page-btn"
          :class="{ active: page === currentPage }"
          @click="currentPage = page"
        >
          {{ page }}
        </button>
        <button
          class="page-btn"
          :disabled="currentPage >= totalPages"
          data-testid="page-next"
          @click="currentPage++"
        >
          下一页
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStatsStore } from '../stores/stats'
import { formatInTimezone } from '../utils/timezone'
import type { ToolCallRow } from '../api/client'

// ── Store ──────────────────────────────────────────────────────────────
const store = useStatsStore()

// ── Filter state ───────────────────────────────────────────────────────
const searchQuery = ref('')
const selectedTool = ref('')
const selectedStatus = ref('')
const selectedSession = ref('')
const dateFrom = ref('')
const dateTo = ref('')

// ── Sort state ─────────────────────────────────────────────────────────
type SortKey = keyof ToolCallRow
const sortKey = ref<SortKey | null>(null)
const sortAsc = ref(true)

// ── Pagination state ───────────────────────────────────────────────────
const PAGE_SIZE = 50
const currentPage = ref(1)

// ── Computed: filter options ───────────────────────────────────────────
const toolOptions = computed(() => {
  const tools = new Set(store.toolCalls.value.map((c) => c.tool_name))
  return [...tools].sort()
})

const sessionOptions = computed(() => {
  const sids = new Set(store.toolCalls.value.map((c) => c.session_id))
  return [...sids].sort()
})

// ── Computed: filtered + sorted data ───────────────────────────────────
const filteredCalls = computed(() => {
  let result = [...store.toolCalls.value]

  // Text search
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (c) =>
        c.tool_name.toLowerCase().includes(q) ||
        c.session_id.toLowerCase().includes(q),
    )
  }

  // Tool filter
  if (selectedTool.value) {
    result = result.filter((c) => c.tool_name === selectedTool.value)
  }

  // Status filter
  if (selectedStatus.value) {
    result = result.filter((c) => c.status === selectedStatus.value)
  }

  // Session filter
  if (selectedSession.value) {
    result = result.filter((c) => c.session_id === selectedSession.value)
  }

  // Date range filter
  if (dateFrom.value) {
    const from = new Date(dateFrom.value)
    result = result.filter((c) => {
      if (!c.started_at) return false
      return new Date(c.started_at) >= from
    })
  }
  if (dateTo.value) {
    const to = new Date(dateTo.value)
    to.setHours(23, 59, 59, 999)
    result = result.filter((c) => {
      if (!c.started_at) return false
      return new Date(c.started_at) <= to
    })
  }

  // Sorting
  if (sortKey.value) {
    const key = sortKey.value
    const dir = sortAsc.value ? 1 : -1
    result.sort((a, b) => {
      const va = a[key]
      const vb = b[key]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
  }

  return result
})

// ── Computed: pagination ───────────────────────────────────────────────
const totalPages = computed(() => Math.max(1, Math.ceil(filteredCalls.value.length / PAGE_SIZE)))

const paginatedCalls = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredCalls.value.slice(start, start + PAGE_SIZE)
})

const paginationStart = computed(() =>
  filteredCalls.value.length === 0 ? 0 : (currentPage.value - 1) * PAGE_SIZE + 1,
)

const paginationEnd = computed(() =>
  Math.min(currentPage.value * PAGE_SIZE, filteredCalls.value.length),
)

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

// Reset page when filters change
watch([searchQuery, selectedTool, selectedStatus, selectedSession, dateFrom, dateTo], () => {
  currentPage.value = 1
})

// ── Methods ────────────────────────────────────────────────────────────
function statusCount(status: string): number {
  return filteredCalls.value.filter((c) => c.status === status).length
}

function resetFilters(): void {
  searchQuery.value = ''
  selectedTool.value = ''
  selectedStatus.value = ''
  selectedSession.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = true
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕'
  return sortAsc.value ? '↑' : '↓'
}

function truncateId(id: string): string {
  if (id.length <= 16) return id
  return id.slice(0, 12) + '...'
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCost(usd: number): string {
  return '$' + usd.toFixed(2)
}

// ── AuditBadge helpers ─────────────────────────────────────────────────
function badgeLabel(status: string): string {
  switch (status) {
    case 'completed':
      return '完成'
    case 'running':
      return '进行中'
    case 'failed':
      return '失败'
    default:
      return status
  }
}

function badgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'badge-success'
    case 'running':
      return 'badge-running'
    case 'failed':
      return 'badge-failed'
    default:
      return 'badge-default'
  }
}
</script>

<style scoped>
/* ── View Container ─────────────────────────────────────────────────── */
.view-container {
  padding: var(--spacing-4);
  max-width: 100%;
}

h1 {
  font-size: var(--text-xl);
  font-weight: 600;
  margin-bottom: var(--spacing-4);
  color: var(--text);
}

/* ── Filter Bar ─────────────────────────────────────────────────────── */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-3);
}

.filter-input,
.filter-select,
.filter-date {
  padding: var(--spacing-2) var(--spacing-3);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--text-base);
  outline: none;
  transition: border-color 0.2s ease;
}

.filter-input:focus,
.filter-select:focus,
.filter-date:focus {
  border-color: var(--primary);
}

.filter-input {
  min-width: 200px;
  flex: 1;
}

.filter-select {
  min-width: 120px;
}

.filter-date {
  min-width: 140px;
}

.filter-reset {
  padding: var(--spacing-2) var(--spacing-3);
  background-color: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-base);
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-reset:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

/* ── Summary Bar ────────────────────────────────────────────────────── */
.summary-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) 0;
  margin-bottom: var(--spacing-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.summary-sep {
  color: var(--border);
}

.summary-success {
  color: var(--success);
}

.summary-running {
  color: var(--primary);
}

.summary-failed {
  color: var(--danger);
}

/* ── Data Table ─────────────────────────────────────────────────────── */
.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.data-table th {
  padding: var(--spacing-2) var(--spacing-3);
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
  user-select: none;
}

.data-table td {
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid rgba(51, 65, 85, 0.4);
  color: var(--text);
  white-space: nowrap;
}

.data-table tbody tr:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.col-sortable {
  cursor: pointer;
}

.col-sortable:hover {
  color: var(--text);
}

.sort-arrow {
  font-size: var(--text-xs);
  opacity: 0.6;
}

.col-center {
  text-align: center;
}

.col-right {
  text-align: right;
}

.col-monospace {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
}

.col-summary {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-muted);
}

.empty-row {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-6) !important;
  font-style: italic;
}

/* ── Audit Badge ────────────────────────────────────────────────────── */
.audit-badge {
  display: inline-block;
  padding: 2px var(--spacing-2);
  border-radius: var(--radius-lg);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
}

.badge-success {
  background-color: rgba(34, 197, 94, 0.15);
  color: var(--success);
}

.badge-running {
  background-color: rgba(59, 130, 246, 0.15);
  color: var(--primary);
}

.badge-failed {
  background-color: rgba(239, 68, 68, 0.15);
  color: var(--danger);
}

.badge-default {
  background-color: rgba(148, 163, 184, 0.15);
  color: var(--text-muted);
}

/* ── Pagination ─────────────────────────────────────────────────────── */
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-3) 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.pagination-controls {
  display: flex;
  gap: var(--spacing-1);
}

.page-btn {
  padding: var(--spacing-1) var(--spacing-2);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.page-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-muted);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-btn.active {
  background-color: var(--primary);
  border-color: var(--primary);
  color: var(--text);
}
</style>
