import {
  type ApiKeySummary,
  type CreateApiKeyInput,
  FIRED_WEBHOOK_EVENT_TYPES,
  type WebhookEndpointSummary,
  type WebhookEventType,
} from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { SettingsNav } from '../components/layout/SettingsNav';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { type Confirmation, ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DialogShell } from '../components/ui/DialogShell';
import { TextField } from '../components/ui/Field';
import { HashBlock } from '../components/ui/HashBlock';
import { BoltIcon } from '../components/ui/icons';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { ApiKeyEmbedOriginsDialog } from '../features/integrations/ApiKeyEmbedOriginsDialog';
import { parseOriginsInput } from '../features/integrations/api-key-origins-form';
import { IntegrationGuide } from '../features/integrations/IntegrationGuide';
import {
  apiKeyAccessDescription,
  apiKeyAccessLabel,
  canRedriveWebhookDelivery,
  WEBHOOK_DELIVERY_LABELS,
  WEBHOOK_EVENT_LABELS,
} from '../features/integrations/integration-presentation';
import { useOneTimeSecretMutation } from '../features/integrations/use-one-time-secret-mutation';
import { webhookInput } from '../features/integrations/webhook-form';
import { api } from '../lib/api';
import { describeError, fieldErrorsOf } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

function CreateApiKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const originsFieldId = useId();
  const [input, setInput] = useState<CreateApiKeyInput>({
    label: '',
    readOnly: false,
    embedOrigins: [],
  });
  const [originsText, setOriginsText] = useState('');
  const [originErrors, setOriginErrors] = useState<string[]>([]);
  const mutation = useOneTimeSecretMutation({
    create: async (input: CreateApiKeyInput) => {
      const result = await api.createApiKey(input);
      return { summary: result.apiKey, rawValue: result.rawKey };
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  });
  const errors = fieldErrorsOf(mutation.error);
  const failure =
    mutation.error && !Object.keys(errors).length ? describeError(mutation.error) : null;
  const close = () => {
    mutation.reset();
    onClose();
  };

  return (
    <DialogShell
      open={open}
      className="[&_button]:min-h-11"
      onClose={close}
      title={mutation.rawValue ? 'Copy your API key' : 'Create API key'}
      onOpen={() => {
        setInput({ label: '', readOnly: false, embedOrigins: [] });
        setOriginsText('');
        setOriginErrors([]);
        mutation.reset();
      }}
      onSubmit={
        mutation.rawValue
          ? undefined
          : () => {
              if (input.readOnly) {
                mutation.mutate({ ...input, embedOrigins: [] });
                return;
              }
              const parsed = parseOriginsInput(originsText);
              if (parsed.errors.length > 0) {
                setOriginErrors(parsed.errors);
                return;
              }
              setOriginErrors([]);
              mutation.mutate({ ...input, embedOrigins: parsed.origins });
            }
      }
      actions={
        mutation.rawValue ? (
          <Button className="min-h-11" onClick={close}>
            I have saved the key
          </Button>
        ) : (
          <>
            <Button
              className="min-h-11"
              variant="secondary"
              onClick={close}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button className="min-h-11" type="submit" loading={mutation.isPending}>
              Create key
            </Button>
          </>
        )
      }
    >
      {mutation.rawValue ? (
        <>
          <Alert tone="info">
            This key is shown once. Copy it now and store it in your secret manager.
          </Alert>
          <HashBlock
            hash={mutation.rawValue}
            label="API key"
            copyLabel="Copy API key"
            valueName="API key"
            testId="raw-api-key"
          />
        </>
      ) : (
        <>
          <TextField
            label="Key label"
            placeholder="HealthProHub production"
            required
            value={input.label}
            onChange={(event) => setInput({ ...input, label: event.target.value })}
            error={errors.label}
          />
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition-colors hover:border-brand-300 has-checked:border-brand-300 has-checked:bg-brand-50/60">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-700"
              checked={input.readOnly}
              onChange={(event) => setInput({ ...input, readOnly: event.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">Read-only key</span>
              <span className="mt-1 block text-xs text-slate-500">
                {apiKeyAccessDescription(true)}
              </span>
            </span>
          </label>
          {!input.readOnly && (
            <>
              <p className="text-xs text-slate-500">{apiKeyAccessDescription(false)}</p>
              <div>
                <label className="block text-sm font-medium" htmlFor={originsFieldId}>
                  Embedded editor origins (optional)
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  One exact HTTPS origin per line, up to 10. Leave blank for a backend-only key.
                </p>
                <textarea
                  id={originsFieldId}
                  rows={2}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm"
                  placeholder="https://healthprohub.example"
                  value={originsText}
                  onChange={(event) => {
                    setOriginsText(event.target.value);
                    setOriginErrors([]);
                  }}
                />
                {originErrors.map((message) => (
                  <Alert key={message}>{message}</Alert>
                ))}
              </div>
            </>
          )}
          {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
        </>
      )}
    </DialogShell>
  );
}

function ApiKeyRow({
  apiKey,
  onRevoke,
  onEditOrigins,
}: {
  apiKey: ApiKeySummary;
  onRevoke: () => void;
  onEditOrigins: () => void;
}) {
  const revoked = Boolean(apiKey.revokedAt);
  const originCount = apiKey.embedOrigins?.length ?? 0;
  return (
    <li className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all text-sm font-semibold text-slate-900">{apiKey.label}</p>
            <Pill>{apiKeyAccessLabel(apiKey.readOnly)}</Pill>
            <Pill tone={revoked ? 'slate' : 'green'}>{revoked ? 'Revoked' : 'Active'}</Pill>
          </div>
          <code className="inline-block max-w-full break-all rounded-md bg-slate-100/80 px-2.5 py-1.5 text-xs text-slate-600">
            {apiKey.displayPrefix}…
          </code>
        </div>
        {!revoked && (
          <div className="flex flex-col gap-2 self-start sm:flex-row">
            {!apiKey.readOnly && (
              <Button className="min-h-11" variant="secondary" onClick={onEditOrigins}>
                Edit origins
              </Button>
            )}
            <Button className="min-h-11" variant="secondary" onClick={onRevoke}>
              Revoke
            </Button>
          </div>
        )}
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Metadata label="Created">{formatDateTime(apiKey.createdAt)}</Metadata>
        <Metadata label="Last used">
          {apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : 'Never used'}
        </Metadata>
        {!apiKey.readOnly && (
          <Metadata label="Embedded editor">
            {originCount === 0
              ? 'Backend only'
              : `${originCount} origin${originCount === 1 ? '' : 's'}`}
          </Metadata>
        )}
        {apiKey.revokedAt && (
          <Metadata label="Revoked">{formatDateTime(apiKey.revokedAt)}</Metadata>
        )}
      </dl>
    </li>
  );
}

function Metadata({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-700">{children}</dd>
    </div>
  );
}

function SectionIcon({ kind }: { kind: 'key' | 'webhook' }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
      {kind === 'webhook' ? (
        <BoltIcon className="h-5 w-5" />
      ) : (
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.5 7.5h.01M21 7.5a4.5 4.5 0 01-6.8 3.86L7 18.5H3V14.5l7.14-7.2A4.5 4.5 0 1121 7.5z"
          />
        </svg>
      )}
    </span>
  );
}

function Pill({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'red' | 'green';
}) {
  const style =
    tone === 'red'
      ? 'bg-red-50 text-red-700'
      : tone === 'green'
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-current/10 ${style}`}
    >
      {children}
    </span>
  );
}

function WebhookDialog({
  open,
  endpoint,
  onClose,
}: {
  open: boolean;
  endpoint: WebhookEndpointSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [allEvents, setAllEvents] = useState(true);
  const [selected, setSelected] = useState<WebhookEventType[]>([]);
  const create = useOneTimeSecretMutation({
    create: async (input: ReturnType<typeof webhookInput>) => {
      const result = await api.createWebhookEndpoint(input);
      return { summary: result.endpoint, rawValue: result.rawSecret };
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.webhookEndpoints }),
  });
  const update = useMutation({
    mutationFn: (input: ReturnType<typeof webhookInput>) =>
      api.updateWebhookEndpoint(endpoint?.id ?? '', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhookEndpoints });
      onClose();
    },
  });
  const mutation = endpoint ? update : create;
  const errors = fieldErrorsOf(mutation.error);
  const failure =
    mutation.error && !Object.keys(errors).length ? describeError(mutation.error) : null;
  const close = () => {
    create.reset();
    update.reset();
    onClose();
  };
  const toggle = (event: WebhookEventType) =>
    setSelected((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );
  const submit = () =>
    mutation.mutate(webhookInput(url, description, allEvents, selected, Boolean(endpoint)));

  return (
    <DialogShell
      open={open}
      className="[&_button]:min-h-11"
      onClose={close}
      title={
        create.rawValue ? 'Copy your signing secret' : endpoint ? 'Edit webhook' : 'Add webhook'
      }
      onOpen={() => {
        setUrl(endpoint?.url ?? '');
        setDescription(endpoint?.description ?? '');
        setAllEvents(!endpoint || endpoint.subscribedEvents.length === 0);
        setSelected(endpoint?.subscribedEvents ?? []);
        create.reset();
        update.reset();
      }}
      onSubmit={create.rawValue ? undefined : submit}
      actions={
        create.rawValue ? (
          <Button className="min-h-11" onClick={close}>
            I have saved the secret
          </Button>
        ) : (
          <>
            <Button
              className="min-h-11"
              variant="secondary"
              onClick={close}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="min-h-11"
              type="submit"
              loading={mutation.isPending}
              disabled={!allEvents && selected.length === 0}
            >
              {endpoint ? 'Save changes' : 'Add webhook'}
            </Button>
          </>
        )
      }
    >
      {create.rawValue ? (
        <>
          <Alert tone="info">
            This signing secret is shown once. Your receiver uses it to verify that events came from
            Envelope.
          </Alert>
          <HashBlock
            hash={create.rawValue}
            label="Webhook signing secret"
            copyLabel="Copy signing secret"
            valueName="Webhook signing secret"
            testId="raw-webhook-secret"
          />
        </>
      ) : (
        <>
          <TextField
            label="Endpoint URL"
            type="url"
            placeholder="https://example.com/webhooks/envelope"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            error={errors.url}
          />
          <TextField
            label="Description (optional)"
            placeholder="Production event receiver"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            error={errors.description}
          />
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-slate-800">Events</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700 transition-colors hover:border-brand-300 has-checked:border-brand-300 has-checked:bg-brand-50/60">
              <input
                className="h-4 w-4 shrink-0 accent-brand-700"
                type="radio"
                name="webhook-events"
                checked={allEvents}
                onChange={() => setAllEvents(true)}
              />{' '}
              All available events
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700 transition-colors hover:border-brand-300 has-checked:border-brand-300 has-checked:bg-brand-50/60">
              <input
                className="h-4 w-4 shrink-0 accent-brand-700"
                type="radio"
                name="webhook-events"
                checked={!allEvents}
                onChange={() => setAllEvents(false)}
              />{' '}
              Choose events
            </label>
            {!allEvents && (
              <div className="grid gap-2 sm:grid-cols-2">
                {FIRED_WEBHOOK_EVENT_TYPES.map((event) => (
                  <label
                    key={event}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 has-checked:border-brand-300 has-checked:bg-brand-50/60"
                  >
                    <input
                      className="h-4 w-4 shrink-0 accent-brand-700"
                      type="checkbox"
                      checked={selected.includes(event)}
                      onChange={() => toggle(event)}
                    />{' '}
                    {WEBHOOK_EVENT_LABELS[event]}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">
              Inbox delivery is not offered because SMTP cannot confirm that a message reached an
              inbox.
            </p>
          </fieldset>
          {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
        </>
      )}
    </DialogShell>
  );
}

function WebhookCard({
  endpoint,
  onEdit,
  onDeactivate,
  onReactivate,
  onDeliveries,
}: {
  endpoint: WebhookEndpointSummary;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onDeliveries: () => void;
}) {
  const events = endpoint.subscribedEvents.length
    ? endpoint.subscribedEvents.map((event) => WEBHOOK_EVENT_LABELS[event]).join(', ')
    : 'All available events';
  return (
    <li className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all text-sm font-semibold text-slate-900">
            {endpoint.description || endpoint.url}
          </p>
          {endpoint.description && (
            <p className="mt-1.5 break-all font-mono text-xs leading-relaxed text-slate-500">
              {endpoint.url}
            </p>
          )}
        </div>
        <Pill tone={endpoint.isActive ? 'green' : 'slate'}>
          {endpoint.isActive ? 'Active' : 'Inactive'}
        </Pill>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metadata label="Events">{events}</Metadata>
        <Metadata label="Signing secret">
          <code className="break-all text-xs">{endpoint.secretDisplayHint}…</code>
        </Metadata>
        <Metadata label="Updated">{formatDateTime(endpoint.updatedAt)}</Metadata>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 sm:justify-end">
        <Button className="min-h-11" variant="secondary" onClick={onDeliveries}>
          Deliveries
        </Button>
        <Button className="min-h-11" variant="secondary" onClick={onEdit}>
          Edit
        </Button>
        {endpoint.isActive ? (
          <Button className="min-h-11" variant="secondary" onClick={onDeactivate}>
            Deactivate
          </Button>
        ) : (
          <Button className="min-h-11" onClick={onReactivate}>
            Reactivate
          </Button>
        )}
      </div>
    </li>
  );
}

function DeliveryDialog({
  endpoint,
  onClose,
}: {
  endpoint: WebhookEndpointSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [redrivenIds, setRedrivenIds] = useState<Set<string>>(() => new Set());
  const deliveries = useQuery({
    queryKey: queryKeys.webhookDeliveries(endpoint?.id ?? ''),
    queryFn: () => api.listWebhookDeliveries(endpoint?.id ?? ''),
    enabled: Boolean(endpoint),
  });
  const redrive = useMutation({
    mutationFn: api.redriveWebhookDelivery,
    onSuccess: (updated) => {
      if (!endpoint) return;
      setRedrivenIds((current) => new Set(current).add(updated.id));
      queryClient.setQueryData(
        queryKeys.webhookDeliveries(endpoint.id),
        (current: typeof deliveries.data) =>
          current?.map((item) => (item.id === updated.id ? updated : item)),
      );
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.webhookDeliveries(endpoint.id) });
      }, 750);
    },
  });
  const close = () => {
    setRedrivenIds(new Set());
    redrive.reset();
    onClose();
  };

  return (
    <DialogShell
      open={Boolean(endpoint)}
      onClose={close}
      title="Webhook deliveries"
      className="max-w-3xl"
      actions={
        <Button className="min-h-11" variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      {endpoint && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-500">Recent attempts for</p>
          <p className="mt-1 break-all font-mono text-xs leading-relaxed text-slate-700">
            {endpoint.url}
          </p>
        </div>
      )}
      {deliveries.error && <ErrorAlert error={deliveries.error} />}
      {redrive.error && <ErrorAlert error={redrive.error} />}
      {deliveries.isLoading ? (
        <Loading label="Loading webhook deliveries" />
      ) : (deliveries.data ?? []).length ? (
        <ul className="space-y-3">
          {deliveries.data?.map((delivery) => (
            <li key={delivery.id} className="min-w-0 rounded-xl border border-slate-200 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {WEBHOOK_EVENT_LABELS[delivery.eventType]}
                    </p>
                    <Pill
                      tone={
                        delivery.status === 'SUCCEEDED'
                          ? 'green'
                          : delivery.status === 'PENDING'
                            ? 'slate'
                            : 'red'
                      }
                    >
                      {WEBHOOK_DELIVERY_LABELS[delivery.status]}
                    </Pill>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Created {formatDateTime(delivery.createdAt)} · {delivery.attempts}{' '}
                    {delivery.attempts === 1 ? 'attempt' : 'attempts'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {delivery.lastAttemptAt
                      ? `Last attempt ${formatDateTime(delivery.lastAttemptAt)}`
                      : 'Not attempted yet'}
                    {delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ''}
                  </p>
                </div>
                {canRedriveWebhookDelivery(delivery.status) && !redrivenIds.has(delivery.id) && (
                  <Button
                    className="min-h-11"
                    variant="secondary"
                    loading={redrive.isPending && redrive.variables === delivery.id}
                    onClick={() => redrive.mutate(delivery.id)}
                  >
                    Retry
                  </Button>
                )}
              </div>
              {delivery.lastError && (
                <p className="mt-4 break-words rounded-lg bg-red-50 px-3 py-3 text-sm text-red-800">
                  {delivery.lastError}
                </p>
              )}
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer content-center rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Event data
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                  {JSON.stringify(delivery.data, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      ) : deliveries.error ? null : (
        <Empty title="No deliveries yet" body="Events sent to this endpoint will appear here." />
      )}
    </DialogShell>
  );
}

export function SettingsIntegrationsPage() {
  useDocumentTitle('Integrations');
  const viewId = useId();
  const [view, setView] = useState<'manage' | 'guide'>('manage');
  const queryClient = useQueryClient();
  const [creatingKey, setCreatingKey] = useState(false);
  const [deliveryEndpoint, setDeliveryEndpoint] = useState<WebhookEndpointSummary | null>(null);
  const [webhookDialog, setWebhookDialog] = useState<{
    open: boolean;
    endpoint: WebhookEndpointSummary | null;
  }>({ open: false, endpoint: null });
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [editingOrigins, setEditingOrigins] = useState<ApiKeySummary | null>(null);
  const keys = useQuery({ queryKey: queryKeys.apiKeys, queryFn: api.listApiKeys });
  const endpoints = useQuery({
    queryKey: queryKeys.webhookEndpoints,
    queryFn: api.listWebhookEndpoints,
  });
  const revoke = useMutation({
    mutationFn: api.revokeApiKey,
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
  });
  const endpointState = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active
        ? api.updateWebhookEndpoint(id, { isActive: true })
        : api.deactivateWebhookEndpoint(id),
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhookEndpoints });
    },
  });
  const confirmRevoke = (key: ApiKeySummary) =>
    setPending({
      title: `Revoke ${key.label}?`,
      body: <p>Anything using this key will lose access immediately. This cannot be undone.</p>,
      confirmLabel: 'Revoke key',
      destructive: true,
      onConfirm: () => revoke.mutate(key.id),
    });
  const confirmDeactivate = (endpoint: WebhookEndpointSummary) =>
    setPending({
      title: 'Deactivate this webhook?',
      body: <p>Envelope will stop sending new events. Its delivery history will be kept.</p>,
      confirmLabel: 'Deactivate webhook',
      destructive: true,
      onConfirm: () => endpointState.mutate({ id: endpoint.id, active: false }),
    });

  return (
    <div className="space-y-6 pb-8">
      <SettingsNav />
      <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />
      <CreateApiKeyDialog open={creatingKey} onClose={() => setCreatingKey(false)} />
      <ApiKeyEmbedOriginsDialog
        apiKey={editingOrigins}
        open={editingOrigins !== null}
        onClose={() => setEditingOrigins(null)}
      />
      <DeliveryDialog endpoint={deliveryEndpoint} onClose={() => setDeliveryEndpoint(null)} />
      <WebhookDialog
        open={webhookDialog.open}
        endpoint={webhookDialog.endpoint}
        onClose={() => setWebhookDialog({ open: false, endpoint: null })}
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Integrations
        </h1>
        <p className="mt-1 text-sm text-slate-500">Connect trusted software to this workspace.</p>
      </div>
      <Tabs
        idPrefix={viewId}
        label="Integration views"
        items={[
          { id: 'manage', label: 'Manage connections' },
          { id: 'guide', label: 'Integration guide' },
        ]}
        value={view}
        onChange={setView}
        className="[&_button]:min-h-11"
      />
      <TabPanel idPrefix={viewId} id="guide" hidden={view !== 'guide'}>
        {view === 'guide' && <IntegrationGuide onManage={() => setView('manage')} />}
      </TabPanel>
      <TabPanel idPrefix={viewId} id="manage" hidden={view !== 'manage'} className="space-y-6">
        <Card
          as="section"
          padding="none"
          aria-labelledby="api-keys-heading"
          className="overflow-hidden"
        >
          <SectionHeading
            id="api-keys-heading"
            kind="key"
            title="API keys"
            description="Let server applications create and track documents."
            action="Create API key"
            onAction={() => setCreatingKey(true)}
          />
          {keys.error && (
            <div className="p-4 sm:p-6">
              <ErrorAlert error={keys.error} />
            </div>
          )}
          {revoke.error && <ErrorAlert error={revoke.error} />}
          {keys.isLoading ? (
            <Loading label="Loading API keys" />
          ) : (keys.data ?? []).length ? (
            <ul className="divide-y divide-slate-100">
              {keys.data?.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  onRevoke={() => confirmRevoke(key)}
                  onEditOrigins={() => setEditingOrigins(key)}
                />
              ))}
            </ul>
          ) : keys.error ? null : (
            <Empty title="No API keys" body="Create one when a trusted server needs access." />
          )}
        </Card>
        <Card
          as="section"
          padding="none"
          aria-labelledby="webhooks-heading"
          className="overflow-hidden"
        >
          <SectionHeading
            id="webhooks-heading"
            kind="webhook"
            title="Webhooks"
            description="Send signed event notifications to your application."
            action="Add webhook"
            onAction={() => setWebhookDialog({ open: true, endpoint: null })}
          />
          {endpoints.error && (
            <div className="p-4 sm:p-6">
              <ErrorAlert error={endpoints.error} />
            </div>
          )}
          {endpointState.error && <ErrorAlert error={endpointState.error} />}
          {endpoints.isLoading ? (
            <Loading label="Loading webhooks" />
          ) : (endpoints.data ?? []).length ? (
            <ul className="divide-y divide-slate-100">
              {endpoints.data?.map((endpoint) => (
                <WebhookCard
                  key={endpoint.id}
                  endpoint={endpoint}
                  onEdit={() => setWebhookDialog({ open: true, endpoint })}
                  onDeactivate={() => confirmDeactivate(endpoint)}
                  onReactivate={() => endpointState.mutate({ id: endpoint.id, active: true })}
                  onDeliveries={() => setDeliveryEndpoint(endpoint)}
                />
              ))}
            </ul>
          ) : endpoints.error ? null : (
            <Empty title="No webhooks" body="Add an endpoint to receive document status events." />
          )}
        </Card>
      </TabPanel>
    </div>
  );
}

function SectionHeading({
  kind,
  id,
  title,
  description,
  action,
  onAction,
}: {
  kind: 'key' | 'webhook';
  id: string;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200/80 bg-slate-50/50 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-start gap-3">
        <SectionIcon kind={kind} />
        <div>
          <h2 id={id} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <Button className="min-h-11 shrink-0" onClick={onAction}>
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {action}
      </Button>
    </div>
  );
}
function ErrorAlert({ error }: { error: unknown }) {
  const described = describeError(error);
  return <Alert reference={described.reference}>{described.message}</Alert>;
}
function Loading({ label }: { label: string }) {
  return (
    <div
      className="m-4 h-28 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none sm:m-6"
      role="status"
      aria-label={label}
    />
  );
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}
