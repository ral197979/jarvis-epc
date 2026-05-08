/**
 * Denver Engineering — MCP Tool & Resource Definitions
 * ─────────────────────────────────────────────
 * Single source of truth for the 43 registered MCP tools and 4 MCP resources.
 * Previously inlined inside JarvisCore (variables `oi` / `Ai`).
 *
 * Extracting here allows:
 *   - MCPToolsPage to import typed definitions without reading the monolith
 *   - Future real transport to swap mock data for live tool discovery
 *   - Tests to assert tool counts and category coverage
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MCPTool {
  name:   string
  desc:   string
  cat:    MCPToolCategory
  params: string[]
}

export interface MCPResource {
  uri:  string
  name: string
  desc: string
  data: Record<string, unknown>
}

export type MCPToolCategory =
  | 'System'
  | 'Browser'
  | 'Automation'
  | 'Vision'
  | 'AGI'
  | 'Skills'
  | 'MCP'
  | 'Security'
  | 'AI'

// ─── Category ordering (controls display order in MCPToolsPage) ───────────────

export const MCP_CATEGORY_ORDER: MCPToolCategory[] = [
  'System', 'Browser', 'Automation', 'Vision', 'AGI', 'Skills', 'MCP', 'Security', 'AI',
]

// ─── Category accent colours (CSS vars) ──────────────────────────────────────

export const MCP_CATEGORY_COLOR: Record<MCPToolCategory, string> = {
  System:     'var(--jarvis-blue)',
  Browser:    'var(--jarvis-cyan)',
  Automation: 'var(--jarvis-amber)',
  Vision:     'var(--jarvis-purple)',
  AGI:        'var(--jarvis-pink)',
  Skills:     'var(--jarvis-green)',
  MCP:        'var(--jarvis-ac)',
  Security:   'var(--jarvis-red)',
  AI:         'var(--jarvis-blue)',
}

// ─── 43 Tool Definitions ─────────────────────────────────────────────────────

export const JARVIS_MCP_TOOLS: MCPTool[] = [
  // System
  { name: 'bash',              desc: 'Execute shell commands',         cat: 'System',     params: ['command'] },
  { name: 'file_read',         desc: 'Read file contents',             cat: 'System',     params: ['path'] },
  { name: 'file_write',        desc: 'Write to file',                  cat: 'System',     params: ['path', 'content'] },
  { name: 'file_search',       desc: 'Search files by pattern',        cat: 'System',     params: ['pattern', 'directory'] },
  { name: 'glob',              desc: 'Glob pattern search',            cat: 'System',     params: ['pattern'] },
  { name: 'http_fetch',        desc: 'HTTP requests',                  cat: 'System',     params: ['url', 'method'] },
  { name: 'process_list',      desc: 'List processes',                 cat: 'System',     params: [] },
  { name: 'process_kill',      desc: 'Kill process',                   cat: 'System',     params: ['pid'] },
  { name: 'clipboard_read',    desc: 'Read clipboard',                 cat: 'System',     params: [] },
  { name: 'clipboard_write',   desc: 'Write clipboard',                cat: 'System',     params: ['text'] },
  // Browser
  { name: 'browser_open',      desc: 'Open URL in headless browser',   cat: 'Browser',    params: ['url'] },
  { name: 'browser_click',     desc: 'Click element',                  cat: 'Browser',    params: ['selector'] },
  { name: 'browser_type',      desc: 'Type into element',              cat: 'Browser',    params: ['selector', 'text'] },
  { name: 'browser_screenshot',desc: 'Capture screenshot',             cat: 'Browser',    params: ['selector'] },
  // Automation
  { name: 'cron_add',          desc: 'Add scheduled task',             cat: 'Automation', params: ['schedule', 'command'] },
  { name: 'cron_list',         desc: 'List cron tasks',                cat: 'Automation', params: [] },
  { name: 'cron_remove',       desc: 'Remove cron task',               cat: 'Automation', params: ['name'] },
  { name: 'webhook_register',  desc: 'Register webhook',               cat: 'Automation', params: ['url', 'events'] },
  { name: 'webhook_list',      desc: 'List webhooks',                  cat: 'Automation', params: [] },
  // Vision
  { name: 'canvas_create',     desc: 'Create drawing canvas',          cat: 'Vision',     params: ['width', 'height'] },
  { name: 'canvas_draw',       desc: 'Draw commands',                  cat: 'Vision',     params: ['commands'] },
  { name: 'vision_capture',    desc: 'Camera capture',                 cat: 'Vision',     params: ['camera_id'] },
  { name: 'vision_analyze',    desc: 'AI image analysis',              cat: 'Vision',     params: ['image', 'prompt'] },
  { name: 'face_recognize',    desc: 'Recognize faces',                cat: 'Vision',     params: ['image'] },
  { name: 'face_add',          desc: 'Add face to DB',                 cat: 'Vision',     params: ['image', 'name'] },
  { name: 'face_list',         desc: 'List known faces',               cat: 'Vision',     params: [] },
  // AGI
  { name: 'agi_reason',        desc: 'AGI reasoning + constitutional safety', cat: 'AGI', params: ['task', 'thinking'] },
  { name: 'agi_plan',          desc: 'Multi-step AGI planning',        cat: 'AGI',        params: ['goal', 'constraints'] },
  { name: 'agi_evolve',        desc: 'Self-improvement iteration',     cat: 'AGI',        params: ['target', 'budget'] },
  { name: 'agi_reflect',       desc: 'Episodic memory reflection',     cat: 'AGI',        params: ['topic'] },
  // Skills
  { name: 'skill_run',         desc: 'Execute Jarvis skill',           cat: 'Skills',     params: ['skill_name', 'args'] },
  { name: 'skill_list',        desc: 'List available skills',          cat: 'Skills',     params: ['category'] },
  { name: 'skill_install',     desc: 'Install skill from registry',    cat: 'Skills',     params: ['skill_id'] },
  // MCP
  { name: 'mcp_tool',          desc: 'Call external MCP server',       cat: 'MCP',        params: ['server', 'tool', 'args'] },
  { name: 'mcp_resource',      desc: 'Read MCP resource',              cat: 'MCP',        params: ['server', 'uri'] },
  // Security
  { name: 'secret_get',        desc: 'Get secret from vault',          cat: 'Security',   params: ['key'] },
  { name: 'secret_set',        desc: 'Store secret',                   cat: 'Security',   params: ['key', 'value'] },
  { name: 'audit_log',         desc: 'Write audit entry',              cat: 'Security',   params: ['action', 'details'] },
  { name: 'audit_query',       desc: 'Query audit log',                cat: 'Security',   params: ['filter'] },
  // AI
  { name: 'session_create',    desc: 'Create agent session',           cat: 'AI',         params: ['model', 'system_prompt'] },
  { name: 'session_resume',    desc: 'Resume session',                 cat: 'AI',         params: ['session_id'] },
  { name: 'model_call',        desc: 'Call LLM directly',              cat: 'AI',         params: ['model', 'messages', 'max_tokens'] },
  { name: 'embedding_create',  desc: 'Create embedding vector',        cat: 'AI',         params: ['text', 'model'] },
]

// ─── MCP Resources ────────────────────────────────────────────────────────────

export const JARVIS_MCP_RESOURCES: MCPResource[] = [
  {
    uri:  'jarvis://config',
    name: 'Configuration',
    desc: 'Gateway config',
    data: { version: '1.6.0', port: 18789, model: 'claude-sonnet-4', skills: 107, tools: 43, uptime: '45d 12h' },
  },
  {
    uri:  'jarvis://agi',
    name: 'AGI Status',
    desc: 'AGI subsystem state',
    data: { modules: 10, lines: 12500, components: 16, constitution: { principles: 7, safety: 7, tripwires: 6 } },
  },
  {
    uri:  'jarvis://skills',
    name: 'Skill Library',
    desc: '107 registered skills',
    data: { total: 107, categories: { anthropic: 16, openai: 32, huggingface: 9, industry: 13, engineering: 37 } },
  },
  {
    uri:  'jarvis://vbrd',
    name: 'VBRD Stats',
    desc: 'Value-Based Reward Distribution',
    data: { totalReward: 847.3, episodes: 1247, avgReward: 0.679, topSkill: 'hvac-engineer' },
  },
]
