/**
 * Denver Engineering — Meeting Minutes Service (v10.9.0)
 * ────────────────────────────────────────────────────────
 * Formal meeting documentation: create, manage agenda items,
 * spawn action items (into existing action_items table), publish.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MeetingType   = 'oac' | 'safety' | 'coordination' | 'progress' | 'kickoff' | 'other'
export type MeetingStatus = 'draft' | 'published' | 'archived'

export interface Attendee {
  name:     string
  company?: string
  role?:    string
}

export interface Meeting {
  id:               string
  projectId:        string
  mtgNumber:        number
  meetingType:      MeetingType
  status:           MeetingStatus
  title:            string
  meetingDate:      string
  startTime:        string | null
  endTime:          string | null
  location:         string | null
  facilitator:      string | null
  attendees:        Attendee[]
  generalNotes:     string | null
  nextMeetingDate:  string | null
  createdBy:        string | null
  publishedAt:      string | null
  createdAt:        string
  agendaItemCount?: number
  actionItemCount?: number
}

export interface AgendaItem {
  id:          string
  meetingId:   string
  sortOrder:   number
  topic:       string
  presenter:   string | null
  durationMin: number | null
  notes:       string | null
  decision:    string | null
  createdAt:   string
}

export interface MeetingActionItem {
  id:          string
  meetingId:   string
  title:       string
  assignedTo:  string | null
  dueDate:     string | null
  priority:    string
  status:      string
  createdAt:   string
}

// ─── Meetings CRUD ────────────────────────────────────────────────────────────

export async function createMeeting(
  tenantId: string,
  input: {
    projectId:       string
    meetingType?:    MeetingType
    title:           string
    meetingDate:     string
    startTime?:      string
    endTime?:        string
    location?:       string
    facilitator?:    string
    attendees?:      Attendee[]
    generalNotes?:   string
    nextMeetingDate?: string
    createdBy?:      string
  },
): Promise<Meeting> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO meetings
       (tenant_id, project_id, mtg_number, meeting_type, title,
        meeting_date, start_time, end_time, location, facilitator,
        attendees, general_notes, next_meeting_date, created_by)
     VALUES (
       $1, $2,
       COALESCE((SELECT MAX(mtg_number) FROM meetings WHERE tenant_id=$1 AND project_id=$2), 0) + 1,
       $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     ) RETURNING *`,
    [
      tenantId, input.projectId,
      input.meetingType ?? 'oac', input.title,
      input.meetingDate,
      input.startTime ?? null, input.endTime ?? null,
      input.location ?? null, input.facilitator ?? null,
      JSON.stringify(input.attendees ?? []),
      input.generalNotes ?? null, input.nextMeetingDate ?? null,
      input.createdBy ?? null,
    ],
  )
  return _map(res.rows[0])
}

export async function getMeeting(tenantId: string, id: string): Promise<Meeting | null> {
  const res = await tenantQuery(tenantId,
    `SELECT m.*,
            (SELECT COUNT(*) FROM meeting_agenda_items a WHERE a.meeting_id=m.id) AS agenda_item_count,
            (SELECT COUNT(*) FROM action_items ai WHERE ai.source_type='meeting' AND ai.source_id=m.id) AS action_item_count
     FROM meetings m WHERE m.id=$1 AND m.tenant_id=$2`,
    [id, tenantId],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

export async function listMeetings(
  tenantId: string,
  projectId: string,
  opts: { meetingType?: MeetingType; status?: MeetingStatus; limit?: number } = {},
): Promise<Meeting[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const res = await tenantQuery(tenantId,
    `SELECT m.*,
            (SELECT COUNT(*) FROM meeting_agenda_items a WHERE a.meeting_id=m.id) AS agenda_item_count,
            (SELECT COUNT(*) FROM action_items ai WHERE ai.source_type='meeting' AND ai.source_id=m.id) AS action_item_count
     FROM meetings m
     WHERE m.tenant_id=$1 AND m.project_id=$2
       AND ($3::meeting_type   IS NULL OR m.meeting_type=$3)
       AND ($4::meeting_status IS NULL OR m.status=$4)
     ORDER BY m.meeting_date DESC, m.created_at DESC
     LIMIT $5`,
    [tenantId, projectId, opts.meetingType ?? null, opts.status ?? null, limit],
  )
  return res.rows.map(_map)
}

export async function updateMeeting(
  tenantId: string,
  id: string,
  patch: Partial<Pick<Meeting, 'title' | 'meetingDate' | 'startTime' | 'endTime' | 'location' | 'facilitator' | 'attendees' | 'generalNotes' | 'nextMeetingDate'>>,
): Promise<Meeting | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE meetings SET
       title            = COALESCE($3, title),
       meeting_date     = COALESCE($4, meeting_date),
       start_time       = COALESCE($5, start_time),
       end_time         = COALESCE($6, end_time),
       location         = COALESCE($7, location),
       facilitator      = COALESCE($8, facilitator),
       attendees        = COALESCE($9::jsonb, attendees),
       general_notes    = COALESCE($10, general_notes),
       next_meeting_date= COALESCE($11, next_meeting_date),
       updated_at       = now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft'
     RETURNING *`,
    [
      id, tenantId,
      patch.title ?? null, patch.meetingDate ?? null,
      patch.startTime ?? null, patch.endTime ?? null,
      patch.location ?? null, patch.facilitator ?? null,
      patch.attendees ? JSON.stringify(patch.attendees) : null,
      patch.generalNotes ?? null, patch.nextMeetingDate ?? null,
    ],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

export async function publishMeeting(tenantId: string, id: string): Promise<Meeting | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE meetings SET status='published', published_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft' RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

export async function archiveMeeting(tenantId: string, id: string): Promise<Meeting | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE meetings SET status='archived', updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='published' RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

// ─── Agenda items ─────────────────────────────────────────────────────────────

export async function listAgendaItems(tenantId: string, meetingId: string): Promise<AgendaItem[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM meeting_agenda_items
     WHERE tenant_id=$1 AND meeting_id=$2
     ORDER BY sort_order, created_at`,
    [tenantId, meetingId],
  )
  return res.rows.map(_mapAgenda)
}

export async function addAgendaItem(
  tenantId: string,
  meetingId: string,
  input: {
    topic:        string
    presenter?:   string
    durationMin?: number
    notes?:       string
    decision?:    string
  },
): Promise<AgendaItem> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO meeting_agenda_items
       (tenant_id, meeting_id, sort_order, topic, presenter, duration_min, notes, decision)
     VALUES (
       $1, $2,
       COALESCE((SELECT MAX(sort_order) FROM meeting_agenda_items WHERE meeting_id=$2), 0) + 10,
       $3, $4, $5, $6, $7
     ) RETURNING *`,
    [tenantId, meetingId, input.topic, input.presenter ?? null,
     input.durationMin ?? null, input.notes ?? null, input.decision ?? null],
  )
  return _mapAgenda(res.rows[0])
}

export async function updateAgendaItem(
  tenantId: string,
  id: string,
  patch: { topic?: string; presenter?: string | null; durationMin?: number | null; notes?: string | null; decision?: string | null },
): Promise<AgendaItem | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE meeting_agenda_items SET
       topic        = COALESCE($3, topic),
       presenter    = COALESCE($4, presenter),
       duration_min = COALESCE($5, duration_min),
       notes        = COALESCE($6, notes),
       decision     = COALESCE($7, decision),
       updated_at   = now()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [id, tenantId, patch.topic ?? null, patch.presenter ?? null,
     patch.durationMin ?? null, patch.notes ?? null, patch.decision ?? null],
  )
  return res.rows[0] ? _mapAgenda(res.rows[0]) : null
}

export async function deleteAgendaItem(tenantId: string, id: string): Promise<void> {
  await tenantQuery(tenantId,
    `DELETE FROM meeting_agenda_items WHERE id=$1 AND tenant_id=$2`,
    [id, tenantId],
  )
}

// ─── Action items (written into shared action_items table) ────────────────────

export async function createMeetingAction(
  tenantId: string,
  meetingId: string,
  projectId: string,
  input: {
    title:       string
    assignedTo?: string | null
    dueDate?:    string | null
    priority?:   'low' | 'medium' | 'high' | 'critical'
    createdBy?:  string
  },
): Promise<MeetingActionItem> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO action_items
       (tenant_id, project_id, title, assigned_to, due_date, priority,
        source_type, source_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'meeting',$7,$8)
     RETURNING *`,
    [
      tenantId, projectId, input.title,
      input.assignedTo ?? null, input.dueDate ?? null,
      input.priority ?? 'medium',
      meetingId, input.createdBy ?? null,
    ],
  )
  return _mapAction(res.rows[0], meetingId)
}

export async function listMeetingActions(
  tenantId: string,
  meetingId: string,
): Promise<MeetingActionItem[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM action_items
     WHERE tenant_id=$1 AND source_type='meeting' AND source_id=$2
     ORDER BY created_at`,
    [tenantId, meetingId],
  )
  return res.rows.map(r => _mapAction(r, meetingId))
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _map(r: Record<string, unknown>): Meeting {
  let attendees: Attendee[] = []
  try {
    const raw = r['attendees']
    attendees = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw) : []
  } catch { /* ignore */ }

  return {
    id:              r['id'] as string,
    projectId:       r['project_id'] as string,
    mtgNumber:       Number(r['mtg_number']),
    meetingType:     r['meeting_type'] as MeetingType,
    status:          r['status'] as MeetingStatus,
    title:           r['title'] as string,
    meetingDate:     String(r['meeting_date']).slice(0, 10),
    startTime:       r['start_time'] ? String(r['start_time']).slice(0, 5) : null,
    endTime:         r['end_time']   ? String(r['end_time']).slice(0, 5)   : null,
    location:        (r['location']  as string) ?? null,
    facilitator:     (r['facilitator'] as string) ?? null,
    attendees,
    generalNotes:    (r['general_notes'] as string) ?? null,
    nextMeetingDate: r['next_meeting_date'] ? String(r['next_meeting_date']).slice(0, 10) : null,
    createdBy:       (r['created_by'] as string) ?? null,
    publishedAt:     r['published_at'] ? new Date(r['published_at'] as string).toISOString() : null,
    createdAt:       new Date(r['created_at'] as string).toISOString(),
    agendaItemCount: r['agenda_item_count'] != null ? Number(r['agenda_item_count']) : undefined,
    actionItemCount: r['action_item_count'] != null ? Number(r['action_item_count']) : undefined,
  }
}

function _mapAgenda(r: Record<string, unknown>): AgendaItem {
  return {
    id:          r['id'] as string,
    meetingId:   r['meeting_id'] as string,
    sortOrder:   Number(r['sort_order']),
    topic:       r['topic'] as string,
    presenter:   (r['presenter'] as string) ?? null,
    durationMin: r['duration_min'] != null ? Number(r['duration_min']) : null,
    notes:       (r['notes'] as string) ?? null,
    decision:    (r['decision'] as string) ?? null,
    createdAt:   new Date(r['created_at'] as string).toISOString(),
  }
}

function _mapAction(r: Record<string, unknown>, meetingId: string): MeetingActionItem {
  return {
    id:         r['id'] as string,
    meetingId,
    title:      r['title'] as string,
    assignedTo: (r['assigned_to'] as string) ?? null,
    dueDate:    r['due_date'] ? String(r['due_date']).slice(0, 10) : null,
    priority:   r['priority'] as string,
    status:     r['status'] as string,
    createdAt:  new Date(r['created_at'] as string).toISOString(),
  }
}
