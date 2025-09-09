// PATH: types/ambient.d.ts

// 1) Remix build ausente em dev: deixe o TS feliz
declare module '../build/server' {
  import type { ServerBuild } from '@remix-run/server-runtime';
  const build: ServerBuild;
  export = build;
}

// 2) Tipagem mínima para o módulo usado no Chat.client.tsx
declare module '~/components/@settings/tabs/providers/service-status/provider-factory' {
  export function resolveAutoProviderModel(opts: any): Promise<any>;
}
