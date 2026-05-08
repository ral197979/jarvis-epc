// Denver Engineering — Agent Worker (v5.0.0)
// Task processing loop with stale task recovery and graceful shutdown.

import { AgentType, WorkerConfig, AgentTask } from './agentTypes'
import { claimNextTask, markTaskRunning, completeTask, failTask, reclaimStaleTasks } from './agentTaskQueue'
import { openExecution, closeExecution, appendExecutionEvent } from './agentExecutionLedger'
import { buildAgentContext } from './agentContextBuilder'
import { checkGovernance } from './agentGovernanceService'
import { executeAgent } from './agents'

// ─── Worker state ─────────────────────────────────────────────────────────────

interface WorkerState {
  running: boolean
  activeTaskCount: number
  pollTimer?: NodeJS.Timeout
  staleTimer?: NodeJS.Timeout
}

const _state: WorkerState = { running: false, activeTaskCount: 0 }

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

export function startWorker(config: WorkerConfig): void {
  if (_state.running) return
  _state.running = true

  _state.pollTimer = setInterval(
    () => _pollAndExecute(config),
    config.pollIntervalMs
  )

  _state.staleTimer = setInterval(
    () => reclaimStaleTasks(config.staleTaskAgeMinutes),
    config.pollIntervalMs * 5
  )
}

export function stopWorker(): void {
  _state.running = false
  if (_state.pollTimer) clearInterval(_state.pollTimer)
  if (_state.staleTimer) clearInterval(_state.staleTimer)
  _state.pollTimer = undefined
  _state.staleTimer = undefined
}

export function getWorkerState(): Readonly<WorkerState> {
  return { ..._state }
}

// ─── Poll and execute ─────────────────────────────────────────────────────────

async function _pollAndExecute(config: WorkerConfig): Promise<void> {
  if (!_state.running) return
  if (_state.activeTaskCount >= config.maxConcurrentTasks) return

  for (let i = 0; i < config.claimBatchSize; i++) {
    if (_state.activeTaskCount >= config.maxConcurrentTasks) break

    const task = await claimNextTask(config.agentTypes, config.workerId)
    if (!task) break

    _state.activeTaskCount++
    _executeTask(config, task).finally(() => {
      _state.activeTaskCount--
    })
  }
}

// ─── Execute a single task ────────────────────────────────────────────────────

async function _executeTask(config: WorkerConfig, task: AgentTask): Promise<void> {
  const execution = await openExecution({
    tenantId: task.tenantId,
    taskId: task.id,
    agentType: task.agentType,
    inputSnapshot: task.payload,
    workerId: config.workerId,
  })

  await markTaskRunning(task.id, task.tenantId, execution.id)

  try {
    // Governance check
    const governance = await checkGovernance({
      tenantId: task.tenantId,
      agentType: task.agentType,
      taskType: task.taskType,
      executionId: execution.id,
      payload: task.payload,
    })

    if (!governance.allowed) {
      throw new Error(`Blocked by policy: ${governance.blockingReason}`)
    }

    // Build context
    const ctx = await buildAgentContext({
      tenantId: task.tenantId,
      agentType: task.agentType,
      scopeType: (task.payload.scopeType as 'project' | 'workflow' | 'action' | 'global') ?? 'global',
      scopeId: (task.payload.scopeId as string) ?? '',
    })

    // Execute agent
    await appendExecutionEvent(execution.id, task.tenantId, 'agent_started', {
      agentType: task.agentType,
      taskType: task.taskType,
    })

    const result = await executeAgent(task.agentType, {
      task,
      execution,
      context: ctx,
      policyChecks: governance.policyChecks,
    })

    await completeTask(task.id, task.tenantId, result)
    await closeExecution(execution.id, task.tenantId, 'completed', result, governance.policyChecks)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await failTask(task.id, task.tenantId, message)
    await closeExecution(execution.id, task.tenantId, 'failed', undefined, [], 0)
  }
}

export const __testHooks = { _pollAndExecute, _executeTask }
