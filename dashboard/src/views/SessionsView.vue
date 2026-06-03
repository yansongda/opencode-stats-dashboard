<template>
  <div class="view-container">
    <h1 class="view-title">Sessions</h1>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <input
        v-model="searchQuery"
        type="text"
        class="filter-input filter-search"
        placeholder="Search session ID, project..."
      />
      <select v-model="filterStatus" class="filter-select">
        <option value="all">All Status</option>
        <option value="active">Active</option>
        <option value="deleted">Deleted</option>
      </select>
      <select v-model="filterModel" class="filter-select">
        <option value="all">All Models</option>
        <option v-for="m in uniqueModels" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filterProject" class="filter-select">
        <option value="all">All Projects</option>
        <option v-for="p in uniqueProjects" :key="p" :value="p">{{ truncateProject(p) }}</option>
      </select>
      <input
        v-model="dateFrom"
        type="date"
        class="filter-input filter-date"
      />
      <span class="filter-sep">to</span>
      <input
        v-model="dateTo"
        type="date"
        class="filter-input filter-date"
      />
      <button class="btn btn-ghost" @click="resetFilters">Reset</button>
    </div>

    <!-- Summary Bar -->
    <div class="summary-bar">
      <span class="summary-total">{{ filteredSessions.length }} sessions</span>
      <span class="summary-sep">|</span>
      <span class="summary-active">{{ activeCount }} active</span>
      <span class="summary-sep">|</span>
      <span class="summary-deleted">{{ deletedCount }} deleted</span>
      <span class="summary-sep">|</span>
      <span class="summary-selected">{{ selectedIds.size }} selected</span>
    </div>

    <!-- Data Table -->
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-checkbox">
              <input
                type="checkbox"
                :checked="isAllSelected"
                :indeterminate="isIndeterminate"
                @change="toggleSelectAll"
              />
            </th>
            <th
              class="col-session-id sortable"
              :class="{ sorted: sortKey === 'session_id' }"
              @click="toggleSort('session_id')"
            >
              Session ID
              <span class="sort-indicator">{{ sortIndicator('session_id') }}</span>
            </th>
            <th
              class="col-project sortable"
              :class="{ sorted: sortKey === 'project_path' }"
              @click="toggleSort('project_path')"
            >
              Project
              <span class="sort-indicator">{{ sortIndicator('project_path') }}</span>
            </th>
            <th
              class="col-model sortable"
              :class="{ sorted: sortKey === 'model' }"
              @click="toggleSort('model')"
            >
              Model
              <span class="sort-indicator">{{ sortIndicator('model') }}</span>
            </th>
            <th
              class="col-tokens sortable"
              :class="{ sorted: sortKey === 'total_tokens' }"
              @click="toggleSort('total_tokens')"
            >
              Tokens
              <span class="sort-indicator">{{ sortIndicator('total_tokens') }}</span>
            </th>
            <th
              class="col-cost sortable"
              :class="{ sorted: sortKey === 'total_cost_usd' }"
              @click="toggleSort('total_cost_usd')"
            >
              Cost
              <span class="sort-indicator">{{ sortIndicator('total_cost_usd') }}</span>
            </th>
            <th class="col-status">Status</th>
            <th
              class="col-date sortable"
              :class="{ sorted: sortKey === 'first_event_at' }"
              @click="toggleSort('first_event_at')"
            >
              First Event
              <span class="sort-indicator">{{ sortIndicator('first_event_at') }}</span>
            </th>
            <th
              class="col-date sortable"
              :class="{ sorted: sortKey === 'last_event_at' }"
              @click="toggleSort('last_event_at')"
            >
              Last Event
              <span class="sort-indicator">{{ sortIndicator('last_event_at') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="session in paginatedSessions"
            :key="session.session_id"
            :class="{ 'row-deleted': session.deleted }"
          >
            <td class="col-checkbox">
              <input
                type="checkbox"
                :checked="selectedIds.has(session.session_id)"
                @change="toggleSelect(session.session_id)"
              />
            </td>
            <td class="col-session-id">
              <code class="session-id">{{ session.session_id }}</code>
            </td>
            <td class="col-project" :title="session.project_path ?? ''">
              {{ truncateProject(session.project_path ?? '—') }}
            </td>
            <td class="col-model">{{ session.model ?? '—' }}</td>
            <td class="col-tokens">{{ formatNumber(session.total_tokens) }}</td>
            <td class="col-cost">{{ formatCost(session.total_cost_usd) }}</td>
            <td class="col-status">
              <AuditBadge :deleted="session.deleted" />
            </td>
            <td class="col-date">{{ formatDateTime(session.first_event_at) }}</td>
            <td class="col-date">{{ relativeTime(session.last_event_at) }}</td>
          </tr>
          <tr v-if="paginatedSessions.length === 0">
            <td colspan="9" class="empty-state">No sessions match the current filters.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination-bar">
      <span class="pagination-info">
        Showing {{ paginationStart }}–{{ paginationEnd }} of {{ filteredSessions.length }}
      </span>
      <div class="pagination-controls">
        <button
          class="btn btn-ghost btn-sm"
          :disabled="currentPage === 1"
          @click="currentPage--"
        >
          Prev
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
          :disabled="currentPage === totalPages"
          @click="currentPage++"
        >
          Next
        </button>
      </div>
    </div>

    <!-- Batch Actions -->
    <div class="batch-actions">
      <button
        class="btn btn-outline"
        :disabled="selectedIds.size === 0"
        @click="exportSelected"
      >
        Export Selected ({{ selectedIds.size }})
      </button>
      <button class="btn btn-outline" @click="exportAll">
        Export All
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStatsStore } from '../stores/stats'
import { fetchExportSessions } from '../api/client'
import type { SessionRow } from '../api/client'

const store = useStatsStore()

// ── Filters ──────────────────────────────────────────────────────────

const searchQuery = ref('')
const filterStatus = ref<'all' | 'active' | 'deleted'>('all')
const filterModel = ref('all')
const filterProject = ref('all')
const dateFrom = ref('')
const dateTo = ref('')

// ── Sorting ──────────────────────────────────────────────────────────

type SortKey = 'session_id' | 'project_path' | 'model' | 'total_tokens' | 'total_cost_usd' | 'first_event_at' | 'last_event_at'
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
  for (const s of store.sessions.value) {
    if (s.model) models.add(s.model)
  }
  return [...models].sort()
})

const uniqueProjects = computed(() => {
  const projects = new Set<string>()
  for (const s of store.sessions.value) {
    if (s.project_path) projects.add(s.project_path)
  }
  return [...projects].sort()
})

const filteredSessions = computed<SessionRow[]>(() => {
  let list = [...store.sessions.value]

  // Status filter
  if (filterStatus.value === 'active') {
    list = list.filter((s) => !s.deleted)
  } else if (filterStatus.value === 'deleted') {
    list = list.filter((s) => s.deleted)
  }

  // Model filter
  if (filterModel.value !== 'all') {
    list = list.filter((s) => s.model === filterModel.value)
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
        (s.project_path ?? '').toLowerCase().includes(q),
    )
  }

  // Date range filter
  if (dateFrom.value) {
    const from = new Date(dateFrom.value).getTime()
    list = list.filter((s) => {
      const t = s.first_event_at ? new Date(s.first_event_at).getTime() : 0
      return t >= from
    })
  }
  if (dateTo.value) {
    const to = new Date(dateTo.value).getTime() + 86400000 // end of day
    list = list.filter((s) => {
      const t = s.first_event_at ? new Date(s.first_event_at).getTime() : 0
      return t <= to
    })
  }

  // Sort
  list.sort((a, b) => {
    const aVal = a[sortKey.value] ?? ''
    const bVal = b[sortKey.value] ?? ''
    let cmp = 0
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal
    } else {
      cmp = String(aVal).localeCompare(String(bVal))
    }
    return sortDir.value === 'asc' ? cmp : -cmp
  })

  return list
})

const activeCount = computed(() => filteredSessions.value.filter((s) => !s.deleted).length)
const deletedCount = computed(() => filteredSessions.value.filter((s) => s.deleted).length)

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

// ── Selection ────────────────────────────────────────────────────────

const selectedIds = ref(new Set<string>())

const isAllSelected = computed(() => {
  if (paginatedSessions.value.length === 0) return false
  return paginatedSessions.value.every((s) => selectedIds.value.has(s.session_id))
})

const isIndeterminate = computed(() => {
  const some = paginatedSessions.value.some((s) => selectedIds.value.has(s.session_id))
  return some && !isAllSelected.value
})

function toggleSelectAll(): void {
  if (isAllSelected.value) {
    // Deselect current page
    for (const s of paginatedSessions.value) {
      selectedIds.value.delete(s.session_id)
    }
  } else {
    // Select all on current page
    for (const s of paginatedSessions.value) {
      selectedIds.value.add(s.session_id)
    }
  }
  // Trigger reactivity
  selectedIds.value = new Set(selectedIds.value)
}

function toggleSelect(id: string): void {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  selectedIds.value = new Set(selectedIds.value)
}

// ── Actions ──────────────────────────────────────────────────────────

function resetFilters(): void {
  searchQuery.value = ''
  filterStatus.value = 'all'
  filterModel.value = 'all'
  filterProject.value = 'all'
  dateFrom.value = ''
  dateTo.value = ''
  selectedIds.value = new Set()
}

function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function exportAll(): Promise<void> {
  try {
    const csv = await fetchExportSessions()
    downloadCsv(csv, 'sessions-all.csv')
  } catch {
    // Fallback: generate CSV from local data
    const csv = generateCsv(store.sessions.value)
    downloadCsv(csv, 'sessions-all.csv')
  }
}

function exportSelected(): void {
  const selected = store.sessions.value.filter((s) => selectedIds.value.has(s.session_id))
  const csv = generateCsv(selected)
  downloadCsv(csv, 'sessions-selected.csv')
}

function generateCsv(rows: SessionRow[]): string {
  const header = 'session_id,project_path,model,total_tokens,total_cost_usd,deleted,first_event_at,last_event_at'
  const lines = rows.map((r) =>
    [
      csvEscape(r.session_id),
      csvEscape(r.project_path ?? ''),
      csvEscape(r.model ?? ''),
      r.total_tokens,
      r.total_cost_usd.toFixed(6),
      r.deleted ? 'true' : 'false',
      csvEscape(r.first_event_at ?? ''),
      csvEscape(r.last_event_at ?? ''),
    ].join(','),
  )
  return [header, ...lines].join('\n')
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

// ── Formatters ───────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = now - then
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDateTime(iso)
}

function truncateProject(path: string): string {
  if (path.length <= 30) return path
  return '…' + path.slice(-28)
}

// ── AuditBadge Component ─────────────────────────────────────────────

const AuditBadge = {
  props: {
    deleted: { type: Boolean, required: true },
  },
  template: `
    <span :class="['audit-badge', deleted ? 'badge-deleted' : 'badge-active']">
      {{ deleted ? 'Deleted' : 'Active' }}
    </span>
  `,
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

.data-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* Deleted row highlight */
.data-table tbody tr.row-deleted {
  background: rgba(239, 68, 68, 0.05);
}

.data-table tbody tr.row-deleted:hover {
  background: rgba(239, 68, 68, 0.08);
}

/* Column widths */
.col-checkbox {
  width: 40px;
  text-align: center;
}

.col-session-id {
  min-width: 120px;
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

.session-id {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
  color: var(--primary);
  background: rgba(59, 130, 246, 0.08);
  padding: 1px var(--spacing-1);
  border-radius: var(--radius-sm);
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-6) !important;
  font-style: italic;
}

/* ── Audit Badge ────────────────────────────────────────────────────── */

:deep(.audit-badge) {
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

/* ── Batch Actions ──────────────────────────────────────────────────── */

.batch-actions {
  display: flex;
  gap: var(--spacing-2);
  padding: var(--spacing-3) 0;
  border-top: 1px solid var(--border);
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

.btn-outline {
  background: transparent;
}

.btn-outline:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.btn-sm {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--text-sm);
}

/* ── Checkbox styling ───────────────────────────────────────────────── */

input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--primary);
  cursor: pointer;
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 900px) {
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
}
</style>
