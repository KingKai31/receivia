// Bundles the shared agent code (src/features/agent/server.ts and what it imports) into one ES module
// that the Deno edge functions import. Run after changing anything under src/features/agent,
// src/features/collect, src/features/forecast or src/lib: `node scripts/build-agent.mjs`.
import path from 'node:path';
import { build } from 'rolldown';

const root = process.cwd();
await build({
  input: path.join(root, 'src/features/agent/server.ts'),
  platform: 'neutral',
  resolve: { alias: { '@': path.join(root, 'src') } },
  plugins: [
    {
      name: 'stub-supabase-client',
      resolveId(id) {
        if (id === '@/lib/supabase') return path.join(root, 'scripts/agent-stub-supabase.ts');
        return null;
      },
    },
  ],
  external: [/^npm:/, /^jsr:/],
  output: {
    file: path.join(root, 'supabase/functions/_shared/agent.bundle.js'),
    format: 'esm',
    minify: false,
  },
});
console.log('built supabase/functions/_shared/agent.bundle.js');
