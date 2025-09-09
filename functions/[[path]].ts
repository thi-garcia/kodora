// PATH: functions/[[path]].ts
import type { ServerBuild } from '@remix-run/cloudflare';
import { createPagesFunctionHandler } from '@remix-run/cloudflare-pages';

let _build: ServerBuild | undefined;

export const onRequest: PagesFunction = async (context) => {
  if (!_build) {
    // Import dinâmico não literal → o TS não tenta resolver ../build/server no typecheck.
    const mod = (await import('../build/' + 'server')) as unknown as ServerBuild;
    _build = mod;
  }

  const handler = createPagesFunctionHandler({ build: _build! });

  return handler(context);
};
