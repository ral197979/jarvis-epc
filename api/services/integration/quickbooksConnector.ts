/**
 * Denver Engineering — QuickBooks Online Connector (v1.0.0)
 * ──────────────────────────────────────────────────────────
 * Real QuickBooks Online integration via Intuit's OAuth 2.0 + REST API.
 *
 * Features:
 *   - OAuth 2.0 authorization code flow (PKCE-ready)
 *   - Token exchange and refresh
 *   - Customer sync (Denver Eng vendor → QBO customer)
 *   - Invoice sync (budget line items → QBO invoices)
 *   - Expense sync (EVM actuals → QBO expenses / purchases)
 *   - Project/class sync (projects → QBO classes)
 *
 * Environment variables required:
 *   QBO_CLIENT_ID       — Intuit app client ID
 *   QBO_CLIENT_SECRET   — Intuit app client secret
 *   QBO_REDIRECT_URI    — OAuth callback URL
 *   QBO_ENVIRONMENT     — 'sandbox' or 'production'
 *
 * QuickBooks API reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QboConfig {
  clientId:     string
  clientSecret: string
  redirectUri:  string
  environment:  'sandbox' | 'production'
}

export interface QboTokens {
  accessToken:       string
  refreshToken:      string
  accessTokenExpiry: number   // Unix timestamp (ms)
  realmId:           string   // QuickBooks company ID
}

export interface QboCustomer {
  id?:          string
  displayName:  string
  email?:       string
  phone?:       string
  address?:     {
    line1?:   string
    city?:    string
    state?:   string
    zip?:     string
    country?: string
  }
}

export interface QboInvoice {
  id?:         string
  customerId:  string
  projectRef?: string       // QBO class ID for project tracking
  lineItems:   QboLineItem[]
  dueDate?:    string       // YYYY-MM-DD
  memo?:       string
  status?:     'Draft' | 'Pending' | 'Sent'
}

export interface QboLineItem {
  description: string
  amount:      number
  quantity?:   number
  unitPrice?:  number
  itemRef?:    string   // QBO Item ID
}

export interface QboExpense {
  id?:           string
  vendorId?:     string
  paymentType:   'Cash' | 'Check' | 'CreditCard'
  totalAmount:   number
  txnDate:       string   // YYYY-MM-DD
  memo?:         string
  projectRef?:   string
  lineItems?:    QboLineItem[]
}

export interface QboSyncResult<T = unknown> {
  ok:        boolean
  entity?:   T
  error?:    string
  errorCode?: string
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

const QBO_BASE: Record<string, string> = {
  sandbox:    'https://sandbox-quickbooks.api.intuit.com/v3/company',
  production: 'https://quickbooks.api.intuit.com/v3/company',
}

const OAUTH_TOKEN_URL    = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const OAUTH_REVOKE_URL   = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const OAUTH_DISCOVER_URL = 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration'

// ─── QuickBooksConnector ──────────────────────────────────────────────────────

export class QuickBooksConnector {
  private readonly cfg: QboConfig
  private tokens: QboTokens | null = null

  constructor(cfg: QboConfig) {
    this.cfg = cfg
  }

  // ── OAuth 2.0 ────────────────────────────────────────────────────────────────

  /**
   * Step 1: Build authorization URL to redirect user to Intuit login.
   * State parameter should be a CSRF-safe random value stored in session.
   */
  buildAuthUrl(state: string, scopes = ['com.intuit.quickbooks.accounting']): string {
    const params = new URLSearchParams({
      client_id:     this.cfg.clientId,
      scope:         scopes.join(' '),
      redirect_uri:  this.cfg.redirectUri,
      response_type: 'code',
      access_type:   'offline',
      state,
    })
    return `https://appcenter.intuit.com/connect/oauth2?${params}`
  }

  /**
   * Step 2: Exchange authorization code for access + refresh tokens.
   * Called in the OAuth callback route.
   */
  async exchangeCode(code: string, realmId: string): Promise<QboTokens> {
    const credentials = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`
    ).toString('base64')

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: this.cfg.redirectUri,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`QBO token exchange failed: ${res.status} ${err.slice(0, 200)}`)
    }

    const data = await res.json() as {
      access_token:  string
      refresh_token: string
      expires_in:    number
    }

    this.tokens = {
      accessToken:       data.access_token,
      refreshToken:      data.refresh_token,
      accessTokenExpiry: Date.now() + data.expires_in * 1000,
      realmId,
    }

    return this.tokens
  }

  /**
   * Step 3: Refresh access token when expired.
   */
  async refreshAccessToken(): Promise<QboTokens> {
    if (!this.tokens) throw new Error('No tokens — must call exchangeCode() first')

    const credentials = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`
    ).toString('base64')

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`QBO token refresh failed: ${res.status} ${err.slice(0, 200)}`)
    }

    const data = await res.json() as {
      access_token:  string
      refresh_token: string
      expires_in:    number
    }

    this.tokens = {
      ...this.tokens,
      accessToken:       data.access_token,
      refreshToken:      data.refresh_token ?? this.tokens.refreshToken,
      accessTokenExpiry: Date.now() + data.expires_in * 1000,
    }

    return this.tokens
  }

  /** Set pre-existing tokens (e.g., loaded from DB). */
  setTokens(tokens: QboTokens): void {
    this.tokens = tokens
  }

  // ── Internal HTTP helpers ─────────────────────────────────────────────────────

  private async ensureValidToken(): Promise<QboTokens> {
    if (!this.tokens) throw new Error('Not authenticated — call exchangeCode() or setTokens()')
    // Refresh if expiring within 60 seconds
    if (this.tokens.accessTokenExpiry < Date.now() + 60_000) {
      return this.refreshAccessToken()
    }
    return this.tokens
  }

  private async _request<T>(
    method: 'GET' | 'POST',
    path:   string,
    body?:  object,
  ): Promise<T> {
    const tokens  = await this.ensureValidToken()
    const baseUrl = QBO_BASE[this.cfg.environment]!
    const url     = `${baseUrl}/${tokens.realmId}${path}`

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`QBO API ${method} ${path} failed: ${res.status} ${err.slice(0, 300)}`)
    }

    return res.json() as Promise<T>
  }

  // ── Customer Sync ────────────────────────────────────────────────────────────

  async createCustomer(customer: QboCustomer): Promise<QboSyncResult<QboCustomer>> {
    try {
      const body: Record<string, unknown> = {
        DisplayName: customer.displayName,
      }
      if (customer.email) {
        body['PrimaryEmailAddr'] = { Address: customer.email }
      }
      if (customer.phone) {
        body['PrimaryPhone'] = { FreeFormNumber: customer.phone }
      }
      if (customer.address) {
        body['BillAddr'] = {
          Line1:                customer.address.line1,
          City:                 customer.address.city,
          CountrySubDivisionCode: customer.address.state,
          PostalCode:           customer.address.zip,
          Country:              customer.address.country,
        }
      }

      const res = await this._request<{ Customer: { Id: string; DisplayName: string } }>(
        'POST', '/customer', { Customer: body }
      )

      return {
        ok:     true,
        entity: { ...customer, id: res.Customer.Id },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  async findCustomerByName(name: string): Promise<QboCustomer | null> {
    const encoded = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${name}'`)
    const res     = await this._request<{ QueryResponse?: { Customer?: Array<{ Id: string; DisplayName: string }> } }>(
      'GET', `/query?query=${encoded}&minorversion=65`
    )
    const customer = res.QueryResponse?.Customer?.[0]
    if (!customer) return null
    return { id: customer.Id, displayName: customer.DisplayName }
  }

  // ── Invoice Sync ─────────────────────────────────────────────────────────────

  async createInvoice(invoice: QboInvoice): Promise<QboSyncResult> {
    try {
      const lines = invoice.lineItems.map(li => ({
        Amount:              li.amount,
        DetailType:          'SalesItemLineDetail',
        Description:         li.description,
        SalesItemLineDetail: {
          Qty:       li.quantity ?? 1,
          UnitPrice: li.unitPrice ?? li.amount,
          ...(li.itemRef ? { ItemRef: { value: li.itemRef } } : {}),
        },
      }))

      const body: Record<string, unknown> = {
        Line:         lines,
        CustomerRef:  { value: invoice.customerId },
        TxnDate:      new Date().toISOString().slice(0, 10),
        ...(invoice.dueDate    ? { DueDate:      invoice.dueDate }    : {}),
        ...(invoice.memo       ? { CustomerMemo: { value: invoice.memo } } : {}),
        ...(invoice.projectRef ? { ClassRef:     { value: invoice.projectRef } } : {}),
      }

      const res = await this._request<{ Invoice: { Id: string } }>('POST', '/invoice', { Invoice: body })
      return { ok: true, entity: res.Invoice }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  // ── Expense Sync ─────────────────────────────────────────────────────────────

  async createExpense(expense: QboExpense): Promise<QboSyncResult> {
    try {
      const lines = (expense.lineItems ?? []).map(li => ({
        Amount:              li.amount,
        DetailType:          'AccountBasedExpenseLineDetail',
        Description:         li.description,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: '1' },   // Default expense account
        },
      }))

      const body: Record<string, unknown> = {
        PaymentType: expense.paymentType,
        TotalAmt:    expense.totalAmount,
        TxnDate:     expense.txnDate,
        Line:        lines,
        ...(expense.vendorId   ? { EntityRef: { value: expense.vendorId, type: 'Vendor' } } : {}),
        ...(expense.memo       ? { PrivateNote: expense.memo }                              : {}),
        ...(expense.projectRef ? { ClassRef: { value: expense.projectRef } }               : {}),
      }

      const res = await this._request<{ Purchase: { Id: string } }>('POST', '/purchase', { Purchase: body })
      return { ok: true, entity: res.Purchase }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  // ── Revoke tokens ─────────────────────────────────────────────────────────────

  async revokeTokens(): Promise<void> {
    if (!this.tokens) return

    const credentials = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`
    ).toString('base64')

    await fetch(OAUTH_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({ token: this.tokens.refreshToken }),
    })

    this.tokens = null
  }
}

// ─── Factory (from env or config) ────────────────────────────────────────────

export function createQuickBooksConnector(overrides?: Partial<QboConfig>): QuickBooksConnector {
  const cfg: QboConfig = {
    clientId:     overrides?.clientId     ?? process.env['QBO_CLIENT_ID']     ?? '',
    clientSecret: overrides?.clientSecret ?? process.env['QBO_CLIENT_SECRET'] ?? '',
    redirectUri:  overrides?.redirectUri  ?? process.env['QBO_REDIRECT_URI']  ?? '',
    environment:  (overrides?.environment ?? process.env['QBO_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production',
  }

  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('QuickBooks connector requires QBO_CLIENT_ID and QBO_CLIENT_SECRET')
  }

  return new QuickBooksConnector(cfg)
}

// ─── Exported as named exports for connector framework registration ───────────

export const CONNECTOR_TYPE = 'quickbooks' as const
export const CONNECTOR_VERSION = '1.0.0'
