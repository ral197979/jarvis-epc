import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, Button, Input, Label, Select, Textarea, Icon } from '@ds'
import { useCreateDeficiency } from '@adapters'

const schema = z.object({
  title: z.string().min(3, 'Describe the deficiency (min 3 chars).'),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

export function LogDeficiencyDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}) {
  const create = useCreateDeficiency(projectId)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { severity: 'medium' },
  })

  const onSubmit = (values: FormValues) =>
    create.mutate(values, {
      onSuccess: () => {
        reset({ severity: 'medium', title: '', description: '' })
        onOpenChange(false)
      },
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset({ severity: 'medium', title: '', description: '' })
        onOpenChange(o)
      }}
    >
      <DialogContent title="Log Deficiency" description="Raise a test-traced deficiency against the active project.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-md">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="e.g. Chiller A pressure transmitter out of calibration" {...register('title')} />
            {errors.title && <p className="mt-1 text-body-sm text-danger">{errors.title.message}</p>}
          </div>

          <div>
            <Label htmlFor="severity">Severity</Label>
            <Select id="severity" className="w-full" {...register('severity')}>
              <option value="low">Low (Cat C)</option>
              <option value="medium">Medium (Cat B)</option>
              <option value="high">High (Cat B)</option>
              <option value="critical">Critical (Cat A — blocking)</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea id="description" rows={3} placeholder="Root cause, location, retest notes…" {...register('description')} />
          </div>

          {create.isError && (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
              {(create.error as Error)?.message ?? 'Failed to log deficiency.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="accent" disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <Icon name="progress_activity" size={18} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Icon name="add" size={18} /> Log Deficiency
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
