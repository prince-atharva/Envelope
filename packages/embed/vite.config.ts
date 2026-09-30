import { defineConfig } from 'vite';

// One self-contained file per format (ADR 0020): `envelope.mjs` for <script type="module">,
// `envelope.js` (IIFE, global `EnvelopeEmbed`) for a plain <script>. Declarations come from tsc.
export default defineConfig({
  build: {
    target: 'es2020',
    minify: true,
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      name: 'EnvelopeEmbed',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'envelope.mjs' : 'envelope.js'),
    },
  },
});
