<template>
  <div class="view-container">
    <h1 class="view-title">导出与清理</h1>

    <!-- Export Section -->
    <section class="section">
      <h2 class="section-title">数据导出</h2>
      <div class="export-grid">
        <!-- Sessions Card -->
        <div class="export-card" data-testid="export-sessions">
          <div class="card-icon-row">
            <span class="card-icon">📋</span>
            <span class="card-count">{{ store.sessions.value.length }} 条</span>
          </div>
          <h3 class="card-title">会话数据</h3>
          <p class="card-desc">ID、项目路径、模型、代币、成本、状态、时间</p>
          <div class="card-actions">
            <button class="btn btn-outline btn-sm" data-testid="export-sessions-csv" @click="exportSessionsCsv">CSV</button>
            <button class="btn btn-outline btn-sm" data-testid="export-sessions-json" @click="exportSessionsJson">JSON</button>
          </div>
        </div>

        <!-- Tool Calls Card -->
        <div class="export-card" data-testid="export-tool-calls">
          <div class="card-icon-row">
            <span class="card-icon">🔧</span>
            <span class="card-count">{{ store.toolCalls.value.length }} 条</span>
          </div>
          <h3 class="card-title">工具调用数据</h3>
          <p class="card-desc">工具名、会话 ID、状态、模型、代币、成本、摘要</p>
          <div class="card-actions">
            <button class="btn btn-outline btn-sm" data-testid="export-tool-calls-csv" @click="exportToolCallsCsv">CSV</button>
            <button class="btn btn-outline btn-sm" data-testid="export-tool-calls-json" @click="exportToolCallsJson">JSON</button>
          </div>
        </div>

        <!-- Overview Card -->
        <div class="export-card" data-testid="export-overview">
          <div class="card-icon-row">
            <span class="card-icon">📊</span>
            <span class="card-count">汇总</span>
          </div>
          <h3 class="card-title">概览统计</h3>
          <p class="card-desc">总会话数、已删除数、总代币、总成本</p>
          <div class="card-actions">
            <button class="btn btn-outline btn-sm" data-testid="export-overview-csv" @click="exportOverviewCsv">CSV</button>
            <button class="btn btn-outline btn-sm" data-testid="export-overview-json" @click="exportOverviewJson">JSON</button>
          </div>
        </div>

        <!-- Full Export Card -->
        <div class="export-card export-card-highlight" data-testid="export-all">
          <div class="card-icon-row">
            <span class="card-icon">📦</span>
            <span class="card-count">全部</span>
          </div>
          <h3 class="card-title">全量导出</h3>
          <p class="card-desc">打包会话、工具调用和概览统计为 JSON 文件</p>
          <div class="card-actions">
            <button class="btn btn-primary" data-testid="export-all-json" @click="exportAll">导出全部</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Cleanup Section -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">数据清理 <span class="title-warning">⚠️</span></h2>
        <span class="section-subtitle">清理操作不可逆，建议先导出数据。</span>
      </div>
      <div class="cleanup-grid">
        <!-- Clean Deleted Records -->
        <div class="cleanup-card" data-testid="cleanup-deleted">
          <div class="card-icon-row">
            <span class="card-icon">🗑️</span>
            <span class="card-count">{{ store.overview.value?.deleted_sessions ?? 0 }} 条</span>
          </div>
          <h3 class="card-title">清理已删除会话记录</h3>
          <p class="card-desc">仅删除标记为"已删除"的审计记录，不影响活跃会话数据</p>
          <div class="card-actions">
            <button
              class="btn btn-outline btn-danger-outline"
              data-testid="cleanup-deleted-btn"
              :disabled="(store.overview.value?.deleted_sessions ?? 0) === 0"
              @click="confirmCleanup('deleted')"
            >
              清理已删除记录
            </button>
          </div>
        </div>

        <!-- Clean All Data -->
        <div class="cleanup-card cleanup-card-danger" data-testid="cleanup-all">
          <div class="card-icon-row">
            <span class="card-icon">⚠️</span>
            <span class="card-count">{{ store.overview.value?.total_sessions ?? 0 }} 条</span>
          </div>
          <h3 class="card-title">清理全部数据</h3>
          <p class="card-desc">删除所有会话、工具调用、统计记录，此操作不可恢复</p>
          <div class="card-actions">
            <button
              class="btn btn-danger"
              data-testid="cleanup-all-btn"
              :disabled="(store.overview.value?.total_sessions ?? 0) === 0"
              @click="confirmCleanup('all')"
            >
              清理全部数据
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Confirm Dialog -->
    <Teleport to="body">
      <div v-if="showDialog" class="dialog-overlay" data-testid="cleanup-confirm-dialog" @click.self="cancelCleanup">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-dialog-title">
          <h3 id="cleanup-dialog-title" class="dialog-title">确认清理</h3>
          <p class="dialog-message">
            此操作将删除
            <strong>{{ cleanupTarget === 'deleted' ? (store.overview.value?.deleted_sessions ?? 0) : (store.overview.value?.total_sessions ?? 0) }}</strong>
            条记录，数据一旦删除无法恢复。
          </p>
          <div class="dialog-actions">
            <button class="btn btn-ghost" data-testid="dialog-cancel" @click="cancelCleanup">取消</button>
            <button class="btn btn-danger" data-testid="dialog-confirm" @click="executeCleanup">确认删除</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useStatsStore } from '../stores/stats'
import { fetchExportSessions, fetchExportToolCalls, cleanupDeleted, cleanupAll } from '../api/client'

const store = useStatsStore()

// ── Download Helpers ──────────────────────────────────────────────────

function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function csvEscape(val: string | number | boolean | null | undefined): string {
  const str = val == null ? '' : String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(csvEscape).join(',')
  const dataLines = rows.map(row => row.map(csvEscape).join(','))
  return [headerLine, ...dataLines].join('\n')
}

// ── Export Actions ────────────────────────────────────────────────────

async function exportSessionsCsv(): Promise<void> {
  try {
    const csv = await fetchExportSessions()
    downloadFile(csv, 'sessions.csv', 'text/csv')
  } catch {
    // Fallback: generate from store data
    const headers = ['session_id', 'project_path', 'model', 'total_tokens', 'total_cost_usd', 'deleted', 'first_event_at', 'last_event_at']
    const rows = store.sessions.value.map(s => [
      s.session_id, s.project_path ?? '', s.model ?? '', s.total_tokens, s.total_cost_usd.toFixed(6), s.deleted, s.first_event_at ?? '', s.last_event_at ?? ''
    ])
    downloadFile(toCsv(headers, rows), 'sessions.csv', 'text/csv')
  }
}

function exportSessionsJson(): void {
  downloadFile(JSON.stringify(store.sessions.value, null, 2), 'sessions.json', 'application/json')
}

function exportToolCallsCsv(): void {
  const headers = ['tool_name', 'session_id', 'status', 'model', 'tokens', 'cost_usd', 'started_at', 'completed_at', 'summary']
  const rows = store.toolCalls.value.map(t => [
    t.tool_name, t.session_id, t.status, t.model ?? '', t.tokens ?? '', t.cost_usd ?? '', t.started_at ?? '', t.completed_at ?? '', t.summary ?? ''
  ])
  downloadFile(toCsv(headers, rows), 'tool-calls.csv', 'text/csv')
}

async function exportToolCallsJson(): Promise<void> {
  try {
    const data = await fetchExportToolCalls()
    downloadFile(JSON.stringify(data, null, 2), 'tool-calls.json', 'application/json')
  } catch {
    downloadFile(JSON.stringify(store.toolCalls.value, null, 2), 'tool-calls.json', 'application/json')
  }
}

function exportOverviewCsv(): void {
  const ov = store.overview.value
  if (!ov) return
  const headers = ['total_sessions', 'deleted_sessions', 'total_tokens', 'total_cost_usd']
  const rows = [[ov.total_sessions, ov.deleted_sessions, ov.total_tokens, ov.total_cost_usd]]
  downloadFile(toCsv(headers, rows), 'overview.csv', 'text/csv')
}

function exportOverviewJson(): void {
  const ov = store.overview.value
  if (!ov) return
  downloadFile(JSON.stringify(ov, null, 2), 'overview.json', 'application/json')
}

function exportAll(): void {
  const allData = {
    exported_at: new Date().toISOString(),
    overview: store.overview.value,
    sessions: store.sessions.value,
    tool_calls: store.toolCalls.value,
  }
  downloadFile(JSON.stringify(allData, null, 2), 'opencode-stats-export.json', 'application/json')
}

// ── Cleanup Dialog ────────────────────────────────────────────────────

const showDialog = ref(false)
const cleanupTarget = ref<'deleted' | 'all' | null>(null)

function confirmCleanup(target: 'deleted' | 'all'): void {
  cleanupTarget.value = target
  showDialog.value = true
}

function cancelCleanup(): void {
  showDialog.value = false
  cleanupTarget.value = null
}

async function executeCleanup(): Promise<void> {
  showDialog.value = false
  try {
    if (cleanupTarget.value === 'deleted') {
      await cleanupDeleted()
    } else if (cleanupTarget.value === 'all') {
      await cleanupAll()
    }
    await store.refreshData()
  } catch (err) {
    console.error('Cleanup failed:', err)
  }
  cleanupTarget.value = null
}
</script>

<style scoped>
/* ── View Container ─────────────────────────────────────────────────── */
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-6);
}

.view-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text);
}

/* ── Section ────────────────────────────────────────────────────────── */
.section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.title-warning {
  font-size: var(--text-base);
}

.section-subtitle {
  font-size: var(--text-sm);
  color: var(--warning);
}

/* ── Export Grid ────────────────────────────────────────────────────── */
.export-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-3);
}

.export-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  transition: border-color 0.2s ease;
}

.export-card:hover {
  border-color: var(--primary);
}

.export-card-highlight {
  border-color: rgba(59, 130, 246, 0.3);
  background-color: rgba(59, 130, 246, 0.05);
}

.export-card-highlight:hover {
  border-color: var(--primary);
}

.card-icon-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-icon {
  font-size: var(--text-xl);
}

.card-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  background-color: rgba(148, 163, 184, 0.1);
  padding: 2px var(--spacing-2);
  border-radius: var(--radius-lg);
}

.card-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.card-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.4;
  flex: 1;
}

.card-actions {
  display: flex;
  gap: var(--spacing-2);
  margin-top: var(--spacing-1);
}

/* ── Cleanup Grid ───────────────────────────────────────────────────── */
.cleanup-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-3);
}

.cleanup-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  transition: border-color 0.2s ease;
}

.cleanup-card:hover {
  border-color: var(--text-muted);
}

.cleanup-card-danger {
  border-color: rgba(239, 68, 68, 0.3);
  background-color: rgba(239, 68, 68, 0.05);
}

.cleanup-card-danger:hover {
  border-color: var(--danger);
}

/* ── Buttons ────────────────────────────────────────────────────────── */
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

.btn-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-danger-outline {
  color: var(--danger);
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-danger-outline:hover:not(:disabled) {
  border-color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
}

.btn-sm {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--text-sm);
}

/* ── Dialog ─────────────────────────────────────────────────────────── */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease;
}

.dialog {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-6);
  max-width: 420px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
  animation: slideIn 0.15s ease;
}

.dialog-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.dialog-message {
  font-size: var(--text-base);
  color: var(--text-muted);
  line-height: 1.5;
}

.dialog-message strong {
  color: var(--danger);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* ── Responsive ─────────────────────────────────────────────────────── */
@media (max-width: 1024px) {
  .export-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .export-grid,
  .cleanup-grid {
    grid-template-columns: 1fr;
  }
}
</style>
