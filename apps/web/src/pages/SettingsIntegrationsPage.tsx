import {
  type ApiKeySummary,
  type CreateApiKeyInput,
  FIRED_WEBHOOK_EVENT_TYPES,
  type WebhookEndpointSummary,
  type WebhookEventType,
} from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SettingsNav } from '../components/layout/SettingsNav';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { type Confirmation, ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DialogShell } from '../components/ui/DialogShell';
import { TextField } from '../components/ui/Field';
import { HashBlock } from '../components/ui/HashBlock';
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
  const [input, setInput] = useState<CreateApiKeyInput>({ label: '', readOnly: false });
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
      onClose={close}
      title={mutation.rawValue ? 'Copy your API key' : 'Create API key'}
      onOpen={() => {
        setInput({ label: '', readOnly: false });
        mutation.reset();
      }}
      onSubmit={mutation.rawValue ? undefined : () => mutation.mutate(input)}
      actions={
        mutation.rawValue ? (
          <Button onClick={close}>I have saved the key</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
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
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
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
            <p className="text-xs text-slate-500">{apiKeyAccessDescription(false)}</p>
          )}
          {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
        </>
      )}
    </DialogShell>
  );
}

function ApiKeyRow({ apiKey, onRevoke }: { apiKey: ApiKeySummary; onRevoke: () => void }) {
  const revoked = Boolean(apiKey.revokedAt);
  return (
    <li className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">{apiKey.label}</p>
          <Pill>{apiKeyAccessLabel(apiKey.readOnly)}</Pill>
          {revoked && <Pill tone="red">Revoked</Pill>}
        </div>
        <p className="mt-1 break-all font-mono text-xs text-slate-500">{apiKey.displayPrefix}…</p>
        <p className="mt-2 text-xs text-slate-500">
          Created {formatDateTime(apiKey.createdAt)} ·{' '}
          {apiKey.lastUsedAt ? `Last used ${formatDateTime(apiKey.lastUsedAt)}` : 'Never used'}
        </p>
      </div>
      {!revoked && (
        <Button size="sm" variant="danger" onClick={onRevoke}>
          Revoke
        </Button>
      )}
    </li>
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
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{children}</span>
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
          <Button onClick={close}>I have saved the secret</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
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
            <label className="flex gap-2 text-sm">
              <input type="radio" checked={allEvents} onChange={() => setAllEvents(true)} /> All
              available events
            </label>
            <label className="flex gap-2 text-sm">
              <input type="radio" checked={!allEvents} onChange={() => setAllEvents(false)} />{' '}
              Choose events
            </label>
            {!allEvents && (
              <div className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                {FIRED_WEBHOOK_EVENT_TYPES.map((event) => (
                  <label key={event} className="flex gap-2 text-sm">
                    <input
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
    <li className="space-y-3 px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all font-semibold text-slate-900">
              {endpoint.description || endpoint.url}
            </p>
            <Pill tone={endpoint.isActive ? 'green' : 'red'}>
              {endpoint.isActive ? 'Active' : 'Inactive'}
            </Pill>
          </div>
          {endpoint.description && (
            <p className="mt-1 break-all text-sm text-slate-600">{endpoint.url}</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Secret {endpoint.secretDisplayHint}… · Updated {formatDateTime(endpoint.updatedAt)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{events}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onDeliveries}>
            Deliveries
          </Button>
          <Button size="sm" variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          {endpoint.isActive ? (
            <Button size="sm" variant="danger" onClick={onDeactivate}>
              Deactivate
            </Button>
          ) : (
            <Button size="sm" onClick={onReactivate}>
              Reactivate
            </Button>
          )}
        </div>
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
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      {endpoint && (
        <p className="break-all text-sm text-slate-500">Recent attempts for {endpoint.url}</p>
      )}
      {deliveries.error && <ErrorAlert error={deliveries.error} />}
      {redrive.error && <ErrorAlert error={redrive.error} />}
      {deliveries.isLoading ? (
        <Loading label="Loading webhook deliveries" />
      ) : (deliveries.data ?? []).length ? (
        <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {deliveries.data?.map((delivery) => (
            <li key={delivery.id} className="rounded-xl border border-slate-200 p-4">
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
                    size="sm"
                    variant="secondary"
                    loading={redrive.isPending && redrive.variables === delivery.id}
                    onClick={() => redrive.mutate(delivery.id)}
                  >
                    Retry
                  </Button>
                )}
              </div>
              {delivery.lastError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                  {delivery.lastError}
                </p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">
                  Event data
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                  {JSON.stringify(delivery.data, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No deliveries yet" body="Events sent to this endpoint will appear here." />
      )}
    </DialogShell>
  );
}

export function SettingsIntegrationsPage() {
  useDocumentTitle('Integrations');
  const queryClient = useQueryClient();
  const [creatingKey, setCreatingKey] = useState(false);
  const [deliveryEndpoint, setDeliveryEndpoint] = useState<WebhookEndpointSummary | null>(null);
  const [webhookDialog, setWebhookDialog] = useState<{
    open: boolean;
    endpoint: WebhookEndpointSummary | null;
  }>({ open: false, endpoint: null });
  const [pending, setPending] = useState<Confirmation | null>(null);
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
    <div className="space-y-8 pb-8">
      <SettingsNav />
      <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />
      <CreateApiKeyDialog open={creatingKey} onClose={() => setCreatingKey(false)} />
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
      <section aria-labelledby="api-keys-heading" className="space-y-4">
        <SectionHeading
          id="api-keys-heading"
          title="API keys"
          description="Let server applications create and track documents."
          action="Create API key"
          onAction={() => setCreatingKey(true)}
        />
        {keys.error && <ErrorAlert error={keys.error} />}
        {revoke.error && <ErrorAlert error={revoke.error} />}
        {keys.isLoading ? (
          <Loading label="Loading API keys" />
        ) : (keys.data ?? []).length ? (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            {keys.data?.map((key) => (
              <ApiKeyRow key={key.id} apiKey={key} onRevoke={() => confirmRevoke(key)} />
            ))}
          </ul>
        ) : (
          <Empty title="No API keys" body="Create one when a trusted server needs access." />
        )}
      </section>
      <section aria-labelledby="webhooks-heading" className="space-y-4">
        <SectionHeading
          id="webhooks-heading"
          title="Webhooks"
          description="Send signed event notifications to your application."
          action="Add webhook"
          onAction={() => setWebhookDialog({ open: true, endpoint: null })}
        />
        {endpoints.error && <ErrorAlert error={endpoints.error} />}
        {endpointState.error && <ErrorAlert error={endpointState.error} />}
        {endpoints.isLoading ? (
          <Loading label="Loading webhooks" />
        ) : (endpoints.data ?? []).length ? (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
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
        ) : (
          <Empty title="No webhooks" body="Add an endpoint to receive document status events." />
        )}
      </section>
    </div>
  );
}

function SectionHeading({
  id,
  title,
  description,
  action,
  onAction,
}: {
  id: string;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id={id} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <Button onClick={onAction}>{action}</Button>
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
      className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white"
      role="status"
      aria-label={label}
    />
  );
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}
