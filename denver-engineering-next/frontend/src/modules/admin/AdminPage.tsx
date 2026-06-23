import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, StatusChip, Badge, Avatar, Button, Icon, DataTable,
  type ColumnDef,
} from '@ds'
import { useAdminUsers, useFeatureGates, type AdminUser, type FeatureGate } from '@adapters'
import { PageHeader } from '../../components/shared'

export function AdminPage() {
  return (
    <div>
      <PageHeader title="Administration" subtitle="Users · roles · SSO · feature gates" />
      <Tabs defaultValue="users">
        <TabsList className="mb-lg">
          <TabsTrigger value="users">Users &amp; Roles</TabsTrigger>
          <TabsTrigger value="gates">Feature Gates</TabsTrigger>
          <TabsTrigger value="sso">SSO &amp; SCIM</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="gates"><GatesTab /></TabsContent>
        <TabsContent value="sso"><SsoTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function UsersTab() {
  const { data = [] } = useAdminUsers()
  const cols: ColumnDef<AdminUser, unknown>[] = [
    { accessorKey: 'name', header: 'User', cell: (c) => (
      <span className="flex items-center gap-2">
        <Avatar name={c.row.original.name} className="h-7 w-7 text-[10px]" />
        <span className="font-semibold text-primary">{c.getValue() as string}</span>
      </span>
    ) },
    { accessorKey: 'email', header: 'Email', cell: (c) => <span className="font-mono-tag text-on-surface-variant">{c.getValue() as string}</span> },
    { accessorKey: 'role', header: 'Role' },
    { accessorKey: 'status', header: 'Status', cell: (c) => <StatusChip status={c.getValue() as string} dot /> },
    { accessorKey: 'lastActive', header: 'Last Active' },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Users &amp; Roles (RBAC)</CardTitle>
        <Button variant="accent" size="sm"><Icon name="person_add" size={18} /> Invite User</Button>
      </CardHeader>
      <DataTable columns={cols} data={data} />
    </Card>
  )
}

function GatesTab() {
  const { data = [] } = useFeatureGates()
  const cols: ColumnDef<FeatureGate, unknown>[] = [
    { accessorKey: 'label', header: 'Feature', cell: (c) => <span className="font-semibold text-primary">{c.getValue() as string}</span> },
    { accessorKey: 'key', header: 'Key', cell: (c) => <span className="font-mono-tag text-on-surface-variant">{c.getValue() as string}</span> },
    { accessorKey: 'rollout', header: 'Rollout' },
    {
      accessorKey: 'enabled',
      header: 'State',
      cell: (c) => (c.getValue() as boolean ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="neutral" dot>Disabled</Badge>),
    },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Feature Gates</CardTitle></CardHeader>
      <DataTable columns={cols} data={data} />
    </Card>
  )
}

function SsoTab() {
  const rows = [
    { icon: 'cloud_done', name: 'SAML 2.0', detail: 'Okta — metadata configured', status: 'Connected' },
    { icon: 'key', name: 'Azure AD (OIDC)', detail: 'Tenant: denver-epc', status: 'Connected' },
    { icon: 'sync_alt', name: 'SCIM 2.0 Provisioning', detail: 'Auto user lifecycle sync', status: 'Active' },
    { icon: 'shield', name: 'Enforce MFA', detail: 'Required for all internal roles', status: 'Enforced' },
  ]
  return (
    <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
      {rows.map((r) => (
        <Card key={r.name} className="flex items-center gap-3 p-md">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-on-primary"><Icon name={r.icon} /></div>
          <div className="flex-1">
            <div className="font-semibold text-primary">{r.name}</div>
            <div className="text-body-sm text-on-surface-variant">{r.detail}</div>
          </div>
          <Badge tone="success" dot>{r.status}</Badge>
        </Card>
      ))}
    </div>
  )
}
