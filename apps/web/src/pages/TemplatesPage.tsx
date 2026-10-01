import { hasAtLeast, type TemplateSummary } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, buttonClass } from '../components/ui/Button';
import { type Confirmation, ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DocumentIcon } from '../components/ui/icons';
import { PageHeader } from '../components/ui/PageHeader';
import { TemplateGridSkeleton } from '../components/ui/Skeletons';
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
    <div className="page-stack">
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

      <PageHeader
        title="Templates"
        description="Documents you send again and again, set up once."
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-4">
            <Link to="/bulk-batches" className="text-sm font-medium text-brand-700 underline">
              Bulk sends
            </Link>
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
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
        }
      />

      {saved && <Alert tone="success">Saved “{saved}” as a template.</Alert>}
      {error && (
        <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>
      )}
      {archiveMutation.error && <Alert>{describeError(archiveMutation.error).message}</Alert>}

      {isLoading ? (
        <TemplateGridSkeleton cards={4} />
      ) : templates.length === 0 ? (
        <div className="empty-surface">
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
        <ul className="grid gap-5 xl:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id} className="surface flex min-w-0 flex-col gap-5 p-5 sm:p-6">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
                  <DocumentIcon className="h-6 w-6" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-words text-lg font-semibold tracking-tight text-slate-900">
                    {template.name}
                  </h2>
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
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                {!template.archivedAt && (
                  <Button size="sm" onClick={() => setUsing(template)}>
                    Use template
                  </Button>
                )}
                {!template.archivedAt && (
                  <Link
                    to={`/templates/${template.id}/bulk`}
                    className={buttonClass('secondary', '', 'sm')}
                  >
                    Send to many
                  </Link>
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
