import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, Button, Input, Label, Select, Icon } from '@ds'
import { useCreateProject } from '@adapters'

const schema = z.object({
  code: z.string().min(2, 'Project code is required.'),
  name: z.string().min(3, 'Project name is required.'),
  client: z.string().optional(),
  region: z.string().optional(),
  phase: z.string().optional(),
  budget: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateProject()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { phase: 'Planning' } })

  const onSubmit = (values: FormValues) =>
    create.mutate(
      {
        code: values.code,
        name: values.name,
        client: values.client || undefined,
        region: values.region || undefined,
        phase: values.phase || undefined,
        budget: values.budget ? Number(values.budget) : undefined,
      },
      {
        onSuccess: () => {
          reset({ phase: 'Planning', code: '', name: '', client: '', region: '', budget: '' })
          onOpenChange(false)
        },
      },
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New Project" description="Create an EPC project in the active tenant.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-md">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <Label htmlFor="code">Code</Label>
              <Input id="code" placeholder="PRJ-2025-001" {...register('code')} />
              {errors.code && <p className="mt-1 text-body-sm text-danger">{errors.code.message}</p>}
            </div>
            <div className="col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. Coastal Desalination Plant" {...register('name')} />
              {errors.name && <p className="mt-1 text-body-sm text-danger">{errors.name.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="client">Client</Label>
              <Input id="client" placeholder="Client name" {...register('client')} />
            </div>
            <div>
              <Label htmlFor="region">Region / Country</Label>
              <Input id="region" placeholder="e.g. AMER" {...register('region')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="phase">Phase</Label>
              <Select id="phase" className="w-full" {...register('phase')}>
                {['Planning', 'Engineering', 'Procurement', 'Construction', 'Commissioning'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="budget">Budget (USD)</Label>
              <Input id="budget" type="number" placeholder="420000000" {...register('budget')} />
            </div>
          </div>

          {create.isError && (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
              {(create.error as Error)?.message ?? 'Failed to create project.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={create.isPending}>
              {create.isPending ? (
                <><Icon name="progress_activity" size={18} className="animate-spin" /> Creating…</>
              ) : (
                <><Icon name="add" size={18} /> Create Project</>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
