import type { EmbedEvent } from '@envelope/shared';
import { createContext, useContext } from 'react';
import { api } from '../../lib/api';
export type EditorApi = Pick<
  typeof api,
  | 'getEnvelope'
  | 'downloadDocument'
  | 'uploadEnvelope'
  | 'updateEnvelope'
  | 'addRecipient'
  | 'updateRecipient'
  | 'removeRecipient'
  | 'saveFields'
  | 'sendEnvelope'
>;
export interface EditorRuntime {
  api: EditorApi;
  embedded: boolean;
  canSend: boolean;
  detail: (id: string) => string;
  prepare: (id: string) => string;
  review: (id: string) => string;
  uploaded?: (id: string) => void;
  sent?: (id: string) => void;
  saved?: (id: string, revision: number) => void;
  registerClose?: (handler: () => Promise<boolean | 'busy'>) => () => void;
  close?: () => void;
  event?: (event: Omit<EmbedEvent, 'version' | 'sessionId'>) => void;
}
export const EditorRuntimeContext = createContext<EditorRuntime>({
  api,
  embedded: false,
  canSend: true,
  detail: (id) => `/dashboard/envelopes/${id}`,
  prepare: (id) => `/dashboard/envelopes/${id}/prepare`,
  review: (id) => `/dashboard/envelopes/${id}/review`,
});
export const useEditorRuntime = () => useContext(EditorRuntimeContext);
