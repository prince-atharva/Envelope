import { hasAtLeast, type TemplateSummary } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { type Confirmation, ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DocumentListSkeleton } from '../components/ui/Skeletons';
import { EditTemplateDialog } from '../features/templates/EditTemplateDialog';
import { templateFacts } from '../features/templates/templates-presentation';
import type { TemplatesPageState } from '../features/templates/templates-state';
import { UseTemplateDialog } from '../features/templates/UseTemplateDialog';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import { formatDate } from '../lib/format';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

/**
 * Reusable documents (docs/20, ADR 0027). Everyone can use a template; Admins
 * also rename, archive and restore them. A template is made from a document
 * you have already prepared, with "Save as template" on its page.
 */
export function TemplatesPage() {
  useDocumentTitle('Templates');
  const { user } = useAuth();
  const isAdmin = !!user && hasAtLeast(user.role, 'ADMIN');
  const location = useLocation();
  const saved = (location.state as TemplatesPageState | null)?.saved;
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [using, setUsing] = useState<TemplateSummary | null>(null);
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [pending, setPending] = useState<Confirmation | null>(null);

  const archived = isAdmin && showArchived;
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.templateList(archived),
    queryFn: () => api.listTemplates(archived),
  });
  const templates = data?.templates ?? [];

  const archiveMutation = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      api.updateTemplate(id, { archived: archive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
  });

  function archive(template: TemplateSummary) {
    setPending({
      title: `Archive “${template.name}”?`,
      body: (
        <p>
          It will no longer appear when people choose a template, and cannot start new documents.
          Documents already made from it are not affected. You can restore it later.
        </p>
      ),
      confirmLabel: 'Archive it',
      destructive: true,
      onConfirm: () => archiveMutation.mutate({ id: template.id, archive: true }),
    });
  }

  return (
    <div className="space-y-6 pb-8">
      <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />
      {using && (
        <UseTemplateDialog
          templateId={using.id}
          templateName={using.name}
          open
          onClose={() => setUsing(null)}
        />
      )}
      {editing && <EditTemplateDialog template={editing} open onClose={() => setEditing(null)} />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Templates
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Documents you send again and again, set up once.
          </p>
        </div>
        {isAdmin && (
          <label className="flex shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Show archived templates
          </label>
        )}
      </div>

      {saved && <Alert tone="success">Saved “{saved}” as a template.</Alert>}
      {error && (
        <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>
      )}
      {archiveMutation.error && <Alert>{describeError(archiveMutation.error).message}</Alert>}

      {isLoading ? (
        <DocumentListSkeleton rows={3} />
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            {archived ? 'No archived templates' : 'No templates yet'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            {archived
              ? 'Templates you archive will be listed here.'
              : isAdmin
                ? 'Prepare a document the way you want it, open it, and choose “Save as template”. Everyone in your workspace can then send it to new people in a few clicks.'
                : 'An admin in your workspace can save a prepared document as a template. It will appear here.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{template.name}</h2>
                  {template.archivedAt && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300">
                      Archived
                    </span>
                  )}
                </div>
                {template.description && (
                  <p className="text-sm text-slate-600">{template.description}</p>
                )}
                <p className="text-xs text-slate-500">
                  {templateFacts(template)} · Saved by {template.createdByName} on{' '}
                  {formatDate(template.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!template.archivedAt && (
                  <Button size="sm" onClick={() => setUsing(template)}>
                    Use template
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(template)}>
                    Edit details
                  </Button>
                )}
                {isAdmin &&
                  (template.archivedAt ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate({ id: template.id, archive: false })}
                    >
                      Restore
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => archive(template)}>
                      Archive
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
