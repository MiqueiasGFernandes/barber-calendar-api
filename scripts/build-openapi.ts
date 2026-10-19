import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';

interface Contract {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: { url: string; description?: string }[];
  security?: Record<string, string[]>[];
  tags?: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, Record<string, unknown>>;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = [
  { prefix: 'Authentication', path: 'specs/001-tenant-authentication/contracts/openapi.yaml' },
  { prefix: 'Scheduling', path: 'specs/002-appointment-scheduling/contracts/openapi.yaml' },
  { prefix: 'Operations', path: 'docs/openapi/operations.yaml' },
] as const;
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rewrite(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => rewrite(item, prefix));
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === '$ref' && typeof item === 'string') {
        const match = /^#\/components\/([^/]+)\/(.+)$/.exec(item);
        if (!match || !match[1] || !match[2]) throw new Error(`Unsupported reference: ${item}`);
        return [
          key,
          `#/components/${match[1]}/${match[1] === 'securitySchemes' ? '' : prefix}${match[2]}`,
        ];
      }
      return [key, rewrite(item, prefix)];
    }),
  );
}

export function buildOpenApi(): Contract {
  const api: Contract = {
    openapi: '3.1.0',
    info: {
      title: 'Barber Calendar API',
      version: '1.0.0',
      description:
        'Documentação geral de autenticação por OTP, catálogo público, reservas, gestão da agenda e operação. As rotas de gestão exigem sessão ativa com papel administrator; o tenant é derivado da sessão. Mutações de agendamento exigem Idempotency-Key com retenção de 24 horas. O servidor /v1 é relativo ao host escolhido pelo consumidor; /health e /ready usam a raiz do mesmo host. Artefato gerado: consulte README.md nesta pasta para fontes, exemplos e atualização.',
    },
    servers: [
      {
        url: '/v1',
        description:
          'Rotas de negócio no host da API; configure o host da sua implantação na ferramenta cliente',
      },
    ],
    security: [],
    tags: [
      {
        name: 'Cadastro',
        description: 'Cadastro provisório e confirmação do primeiro administrador.',
      },
      { name: 'Autenticação', description: 'Solicitação e consumo de OTP por e-mail.' },
      {
        name: 'Disponibilidade Pública',
        description: 'Catálogo e consulta de horários sem sessão.',
      },
      { name: 'Agendamentos Públicos', description: 'Reservas de convidados.' },
      {
        name: 'Gestão',
        description: 'Configuração e agenda do tenant autorizado; papel administrator obrigatório.',
      },
      { name: 'Operação', description: 'Verificações do processo e da conexão/revisão do banco.' },
    ],
    paths: {},
    components: {},
  };
  const ids = new Set<string>();
  for (const source of sources) {
    const contract = YAML.parse(readFileSync(resolve(root, source.path), 'utf8')) as Contract;
    if (contract.openapi !== '3.1.0')
      throw new Error(`Unsupported OpenAPI version: ${source.path}`);
    for (const [section, entries] of Object.entries(contract.components)) {
      const target = (api.components[section] ??= {});
      for (const [name, entry] of Object.entries(entries)) {
        const targetName = section === 'securitySchemes' ? name : `${source.prefix}${name}`;
        const rewritten = rewrite(entry, source.prefix);
        if (Object.hasOwn(target, targetName) && !isDeepStrictEqual(target[targetName], rewritten))
          throw new Error(`Conflicting component: ${targetName}`);
        target[targetName] = rewritten;
      }
    }
    for (const [path, item] of Object.entries(contract.paths)) {
      if (Object.hasOwn(api.paths, path)) throw new Error(`Duplicate path: ${path}`);
      const rewritten = rewrite(item, source.prefix) as Record<string, unknown>;
      if (source.prefix === 'Operations') rewritten.servers = contract.servers;
      for (const [method, operation] of Object.entries(rewritten)) {
        if (!methods.has(method) || !object(operation)) continue;
        const id = operation.operationId;
        if (typeof id !== 'string' || ids.has(id))
          throw new Error(`Missing or duplicate operationId: ${path}`);
        ids.add(id);
        operation.security ??= contract.security ?? [];
      }
      api.paths[path] = rewritten;
    }
  }
  return api;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

function render(api: Contract): string {
  const sections = Object.entries(api.paths)
    .flatMap(([path, item]) =>
      Object.entries(item).flatMap(([method, operation]) => {
        if (!methods.has(method) || !object(operation)) return [];
        const server = path === '/health' || path === '/ready' ? '' : '/v1';
        const secure = Array.isArray(operation.security) && operation.security.length > 0;
        return [
          `<article><h2>${escapeHtml(method.toUpperCase())} ${escapeHtml(server + path)}</h2><p>${escapeHtml(String(operation.summary))}</p><p>${secure ? 'Sessão de administrador' : 'Acesso público'}</p><details><summary>Contrato da operação</summary><pre>${escapeHtml(YAML.stringify(operation))}</pre></details></article>`,
        ];
      }),
    )
    .join('\n');
  return `<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Barber Calendar API</title>
<style>body{font:16px/1.6 system-ui;margin:0;background:#f6f7fb;color:#162536}main{max-width:1000px;margin:auto;padding:32px}a{color:#0756a1}article,details.components{background:white;border:1px solid #d6dce5;border-radius:8px;padding:20px;margin:16px 0}h2{font-size:18px;overflow-wrap:anywhere}pre{overflow:auto;font-size:14px}summary{cursor:pointer}input{font:inherit;padding:10px;width:100%;box-sizing:border-box}label{display:block;font-weight:600}</style>
<main><h1>Barber Calendar API</h1><p>OpenAPI 3.1 · Autenticação, agendamento e operação</p><p><a href="README.md">Guia de consumo</a> · <a href="openapi.yaml">Contrato YAML</a> · <a href="openapi.json">Contrato JSON</a></p><p>Consulta local sem requisições à API. Configure o host da implantação ao importar o contrato em uma ferramenta cliente.</p><label for="search">Filtrar operações</label><input id="search" type="search" placeholder="Ex.: disponibilidade, appointments, OTP"><p id="count" role="status" aria-live="polite"></p>${sections}<details class="components"><summary>Schemas, parâmetros, respostas e segurança</summary><pre>${escapeHtml(YAML.stringify(api.components))}</pre></details></main>
<script>const input=document.getElementById('search'),articles=[...document.querySelectorAll('article')],count=document.getElementById('count');function filter(){const query=input.value.toLocaleLowerCase('pt-BR');let visible=0;for(const article of articles){article.hidden=!article.textContent.toLocaleLowerCase('pt-BR').includes(query);if(!article.hidden)visible++}count.textContent=visible+' de '+articles.length+' operações';}input.addEventListener('input',filter);filter();</script></html>\n`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const api = buildOpenApi();
  const artifacts = {
    'openapi.yaml': `# Gerado por yarn docs:openapi; editar os contratos fonte.\n${YAML.stringify(api, { lineWidth: 100 })}`,
    'openapi.json': `${JSON.stringify(api, null, 2)}\n`,
    'index.html': render(api),
  };
  for (const [file, contents] of Object.entries(artifacts)) {
    const path = resolve(root, 'docs/openapi', file);
    if (process.argv.includes('--check')) {
      if (readFileSync(path, 'utf8') !== contents)
        throw new Error(`${file} is stale; run yarn docs:openapi`);
    } else writeFileSync(path, contents);
  }
}
