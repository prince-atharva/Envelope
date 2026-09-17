import { readFileSync } from 'node:fs';
import path from 'node:path';

// This file sits directly under src/ (and dist/ once compiled), so the package
// manifest is always one directory up.
const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
  version: string;
};

export const APP_VERSION: string = manifest.version;
