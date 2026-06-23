import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { KpiCard, StatusChip } from '@ds'
import { CrmPage } from '../modules/crm/CrmPage'

function withProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('design-system render', () => {
  it('renders a KpiCard with label and value', () => {
    render(<KpiCard label="Total Contract Value" value="$1.42B" />)
    expect(screen.getByText('Total Contract Value')).toBeInTheDocument()
    expect(screen.getByText('$1.42B')).toBeInTheDocument()
  })

  it('infers tone and renders a status chip', () => {
    render(<StatusChip status="Critical" />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })
})

describe('module screen render', () => {
  it('mounts the CRM page and loads mock-driven content', async () => {
    render(withProviders(<CrmPage />))
    // Static chrome renders immediately.
    expect(screen.getByText('CRM — Lead Pipeline')).toBeInTheDocument()
    // Async adapter data resolves into the table.
    await waitFor(() => expect(screen.getByText('Red Sea Desalination')).toBeInTheDocument())
  })
})
