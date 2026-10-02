import {
  BRAND_LOGO_MAX_BYTES,
  type BrandingSettings,
  DEFAULT_ACCENT_COLOR,
  isReadableWithWhiteText,
} from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { SettingsNav } from '../components/layout/SettingsNav';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { BrandingPageSkeleton } from '../components/ui/Skeletons';
import { BrandPreview } from '../features/branding/BrandPreview';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const LOGO_TYPES = ['image/png', 'image/jpeg'];

/** Settings -> Branding (docs/22 step 8, ADR 0034). Admins and owners. */
export function SettingsBrandingPage() {
  useDocumentTitle('Branding');
  const queryClient = useQueryClient();
  const colourId = useId();
  const colourHintId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.branding,
    queryFn: api.getBranding,
  });

  const remember = (settings: BrandingSettings, message: string) => {
    queryClient.setQueryData(queryKeys.branding, settings);
    setSaved(message);
  };

  const colourMutation = useMutation({
    mutationFn: (color: string | null) => api.updateBranding({ color }),
    onSuccess: (settings, color) => {
      setDraft(null);
      remember(settings, color ? 'Accent colour saved.' : 'Back to the default colour.');
    },
  });
  const logoMutation = useMutation({
    mutationFn: (file: File) => api.setBrandLogo(file),
    onSuccess: (settings) => remember(settings, 'Logo saved.'),
  });
  const removeLogoMutation = useMutation({
    mutationFn: () => api.removeBrandLogo(),
    onSuccess: (settings) => remember(settings, 'Logo removed.'),
  });

  if (isLoading) return <BrandingPageSkeleton />;

  const current = data?.color ?? '';
  const value = draft ?? current;
  const valid = HEX_COLOUR.test(value);
  const readable = valid && isReadableWithWhiteText(value);
  const colourProblem =
    value === ''
      ? null
      : !valid
        ? 'Use a colour like #1d4ed8.'
        : readable
          ? null
          : 'This colour is too light for white text. Choose a darker one.';
  const changed = value.toLowerCase() !== current.toLowerCase();
  const previewColour = readable ? value : (data?.color ?? null);
  const failure = colourMutation.error ?? logoMutation.error ?? removeLogoMutation.error ?? error;

  function chooseFile(file: File | undefined) {
    setSaved(null);
    setFileError(null);
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setFileError('Choose a PNG or JPEG image.');
    } else if (file.size > BRAND_LOGO_MAX_BYTES) {
      setFileError(`The logo must be smaller than ${Math.round(BRAND_LOGO_MAX_BYTES / 1024)} KB.`);
    } else {
      logoMutation.mutate(file);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div className="page-stack">
      <PageHeader
        flat
        title="Branding"
        description="Your logo and colour on the emails and pages your recipients see."
      />
      <SettingsNav />

      {failure && (
        <Alert reference={describeError(failure).reference}>{describeError(failure).message}</Alert>
      )}
      {fileError && <Alert>{fileError}</Alert>}
      {saved && !failure && !fileError && <Alert tone="success">{saved}</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card as="section" aria-labelledby={`${colourId}-title`}>
            <h2 id={`${colourId}-title`} className="section-title">
              Accent colour
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Used for buttons and headers. White text must stay readable on it.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor={colourId} className="block text-sm font-medium text-slate-800">
                  Colour
                </label>
                <input
                  id={colourId}
                  className="form-control mt-2 block w-40 border border-slate-300 px-3 py-2.5 font-mono text-slate-900"
                  value={value}
                  placeholder={DEFAULT_ACCENT_COLOR}
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={colourProblem ? true : undefined}
                  aria-describedby={colourProblem ? colourHintId : undefined}
                  onChange={(event) => {
                    setSaved(null);
                    setDraft(event.target.value.trim());
                  }}
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
                Pick
                <input
                  type="color"
                  className="h-11 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                  value={valid ? value : DEFAULT_ACCENT_COLOR}
                  onChange={(event) => {
                    setSaved(null);
                    setDraft(event.target.value);
                  }}
                />
              </label>
              <Button
                onClick={() => colourMutation.mutate(value === '' ? null : value.toLowerCase())}
                disabled={!changed || (value !== '' && !readable)}
                loading={colourMutation.isPending}
              >
                Save colour
              </Button>
              {data?.color && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(null);
                    colourMutation.mutate(null);
                  }}
                  disabled={colourMutation.isPending}
                >
                  Use the default
                </Button>
              )}
            </div>
            {colourProblem && (
              <p id={colourHintId} className="mt-2 text-xs text-red-700">
                {colourProblem}
              </p>
            )}
          </Card>

          <Card as="section" aria-labelledby={`${colourId}-logo`}>
            <h2 id={`${colourId}-logo`} className="section-title">
              Logo
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              PNG or JPEG, up to {Math.round(BRAND_LOGO_MAX_BYTES / 1024)} KB. It is resized to fit
              480 by 160 pixels.
            </p>
            {data?.logoUrl && (
              <img
                src={data.logoUrl}
                alt={`${data.workspaceName} logo`}
                className="mt-4 max-h-16 max-w-60 rounded border border-slate-200 bg-white object-contain p-2"
              />
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                id={`${colourId}-file`}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              <label
                htmlFor={`${colourId}-file`}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 has-[:focus-visible]:outline-2"
              >
                {logoMutation.isPending
                  ? 'Uploading…'
                  : data?.logoUrl
                    ? 'Replace logo'
                    : 'Upload logo'}
              </label>
              {data?.logoUrl && (
                <Button
                  variant="dangerOutline"
                  onClick={() => removeLogoMutation.mutate()}
                  loading={removeLogoMutation.isPending}
                >
                  Remove logo
                </Button>
              )}
            </div>
          </Card>
        </div>

        <section aria-label="Preview" className="space-y-3">
          <h2 className="section-title">Preview</h2>
          <BrandPreview
            workspaceName={data?.workspaceName ?? ''}
            color={previewColour}
            logoUrl={data?.logoUrl ?? null}
          />
          <p className="text-xs text-slate-500">
            Emails to recipients, the signing page and the download page use this. Many mail clients
            block remote images, so the coloured header and your name carry the brand there.
          </p>
        </section>
      </div>
    </div>
  );
}
