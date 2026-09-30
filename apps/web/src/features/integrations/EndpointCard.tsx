import { DOCUMENT_CATEGORIES } from '@envelope/shared';
import { Alert } from '../../components/ui/Alert';
import { ExampleBlock } from './IntegrationExampleBlock';
import { type EndpointReference, requestExample } from './integration-reference';

interface EndpointCardProps {
  endpoint: EndpointReference;
  base: string;
}

export function EndpointCard({ endpoint, base }: EndpointCardProps) {
  return (
    <details className="group min-w-0 rounded-xl border border-slate-200 bg-white open:shadow-sm">
      <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-3 rounded-xl p-4 focus-visible:outline-brand-700">
        <span
          className={`rounded-md px-2 py-1 font-mono text-xs font-bold ${endpoint.method === 'GET' ? 'bg-emerald-50 text-emerald-800' : endpoint.method === 'DELETE' ? 'bg-red-50 text-red-800' : 'bg-brand-50 text-brand-800'}`}
        >
          {endpoint.method}
        </span>
        <span className="min-w-0 flex-1 basis-48">
          <span className="block break-all font-mono text-xs font-medium text-slate-800">
            {endpoint.path}
          </span>
          <span className="mt-1 block text-sm text-slate-500">{endpoint.title}</span>
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {endpoint.apiKey === 'read' ? 'Read or full access' : 'Full access'}
        </span>
        <span aria-hidden="true" className="text-slate-400 group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4 sm:p-5">
        <p className="text-sm leading-6 text-slate-600">{endpoint.description}</p>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          {endpoint.inputs.map((input) => (
            <li key={input}>{input}</li>
          ))}
        </ul>
        {endpoint.id === 'upload' && (
          <p className="text-xs leading-6 text-slate-500">
            Document categories: {DOCUMENT_CATEGORIES.join(', ')}. The chosen jurisdiction may block
            some categories.
          </p>
        )}
        {endpoint.revision && (
          <Alert tone="info">
            Send the latest draftRevision in If-Match, quoted. After each successful edit, replace
            DRAFT_REVISION with the returned value. On 412, fetch the draft again and reconcile
            before retrying.
          </Alert>
        )}
        <ExampleBlock title={`${endpoint.title} request`} text={requestExample(endpoint, base)} />
        <p className="text-xs font-medium text-slate-500">{endpoint.responseNote}</p>
        <ExampleBlock
          title={`${endpoint.title} response`}
          text={
            typeof endpoint.response === 'string'
              ? endpoint.response
              : JSON.stringify(endpoint.response, null, 2)
          }
        />
        <p className="text-sm leading-6 text-slate-600">
          <strong className="text-slate-800">When it fails: </strong>
          {endpoint.errorCodes.length > 0 ? `${endpoint.errorCodes.join(', ')}. ` : ''}
          {endpoint.errorNote}
        </p>
      </div>
    </details>
  );
}
