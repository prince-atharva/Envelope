import { useEffect } from 'react';
import { pageTitle } from './format';

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
