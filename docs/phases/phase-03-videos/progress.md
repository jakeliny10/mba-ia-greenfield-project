# phase-03-videos — Progresso

**Status:** concluída
**SIs:** 7/7 implementadas e verificadas.

### SI-03.1 — Fundação Codex, dependências e infraestrutura

- **Status:** implementada.
- **Evidência:** `AGENTS.md` aponta para `CLAUDE.md`; `.agents/skills` aponta para as skills do projeto; `.codex/config.toml` configura os servidores MCP. Compose sobe API, PostgreSQL, Mailpit, Redis, storage S3 compatível e worker. PostgreSQL responde a `pg_isready`; worker inicia com TypeORM, Redis e entidades relacionadas.
- **Testes:** `npm test` 27 suítes / 167 testes verdes; `npm run test:e2e` 4 suítes / 54 testes verdes. O teste antigo de migrations e a fixture de variáveis S3 foram corrigidos.
- **Observação:** a imagem comunitária oficial do MinIO retornou `unauthorized` ao baixar; o Compose usa Silo, fork do MinIO com API S3 compatível, exercitado no E2E.

### SI-03.2 — Modelo de vídeo e migration

- **Status:** implementada.
- **Evidência:** entidade `Video` ligada a `Channel`, enum de estado, UUID público único, chaves de storage e campos de metadados; migration `CreateVideos1790704980989` aplicada.
- **Testes:** `migrations.integration-spec.ts` aplica e desfaz a migration; `video.entity.integration-spec.ts` verifica FK, unicidade, estado inicial e tamanho de 10 GiB em PostgreSQL real.

### SI-03.3 — Início e envio multipart

- **Status:** implementada.
- **Evidência:** `POST /videos` cria rascunho; `POST /videos/:publicId/upload/parts` assina PUT direto ao storage; autorização por dono e limite de 10 GiB/160 partes.
- **Testes:** `videos.e2e-spec.ts` envia o vídeo de teste pela URL assinada e verifica que o limite de 10 GiB aceita a parte 160 e rejeita a 161.

### SI-03.4 — Conclusão e publicação na fila

- **Status:** implementada.
- **Evidência:** a conclusão valida as partes reais no storage, fecha o multipart, registra o tamanho e publica `video.process` com `jobId` estável; abortar remove o rascunho.
- **Testes:** `videos.e2e-spec.ts` conclui upload real, observa processamento e repete a conclusão com sucesso; também aborta um upload grande ainda vazio.

### SI-03.5 — Processamento no worker

- **Status:** implementada.
- **Evidência:** worker separado usa ffprobe/ffmpeg, grava thumbnail no storage e atualiza `draft → processing → ready/error`. O worker carrega `User`, `Channel` e `Video` no TypeORM para resolver as relações.
- **Testes:** `video-processing.service.spec.ts` valida parsing de metadados; `video.processor.spec.ts` verifica idempotência e falha terminal; `videos.e2e-spec.ts` aguarda `ready` e verifica duração e thumbnail produzidos pelo worker real.

### SI-03.6 — Consulta, streaming, thumbnail e download

- **Status:** implementada.
- **Evidência:** metadados de rascunho exigem autenticação do dono; vídeo pronto é público. Streaming e download usam stream com suporte a `Range`, 200/206/416 e `Content-Disposition` no download.
- **Testes:** `video-range.spec.ts` cobre intervalos abertos, sufixos e inválidos; `videos.e2e-spec.ts` verifica autorização, bytes do original, 206, 416, download e thumbnail.

### SI-03.7 — Fechamento e documentação

- **Status:** concluída.
- **Evidência:** Swagger nos endpoints, README e instruções `CLAUDE.md`/`AGENTS.md` atualizados para a arquitetura real. Este arquivo registra testes por SI.
- **Testes:** `npm test` 27/27 suítes e 167/167 testes; `npm run test:e2e` 4/4 suítes e 54/54 testes; `npx tsc --noEmit`, `npm run lint` e `git diff --check` com código 0. `docker compose ps` mostra `db`, `mailpit`, `minio`, `nestjs-api`, `redis` e `video-worker` ativos. `openapi.json` contém as oito rotas de vídeo.

## Revisão contra o enunciado

| Critério | Evidência |
|---|---|
| Research e decisões justificadas | `docs/decisions/technical-decisions-phase-03-videos.md`, TD-01 a TD-07 |
| Pipeline de planejamento e validação clean | `context.md`, `validation.md` com `status: clean`, `library-refs.md` e `phase-03-videos.md` com SIs, especificações, mapa e entregáveis |
| Upload direto até 10 GiB e rascunho | API multipart, URL assinada PUT real no E2E; limite de 10 GiB/160 partes testado sem transferir fisicamente 10 GiB |
| Processamento, metadados, thumbnail e estados | E2E com Redis, storage e worker reais; testes unitários de parser, idempotência e falha terminal |
| URL única, streaming e download | `public_id` UUID com `UNIQUE`; E2E de bytes completos, `Range` 206/416, download e JPEG |
| Infraestrutura e migration | Compose com storage, Redis e worker; teste de migration aplica/desfaz tabela; teste de entidade verifica FK e unicidade |
| Qualidade | 167 testes unitários/de integração, 54 E2E, TypeScript e lint verdes |
| Git Flow e ferramenta Codex | branch `feature/phase-03-videos` descendente de `dev`; `AGENTS.md`, `.agents/skills` e `.codex/config.toml` presentes |
| Documentação atualizada | `CLAUDE.md`, `nestjs-project/CLAUDE.md`, `README.md` e `openapi.json` refletem a Fase 03 |

O Context7 não foi exposto nesta sessão; `library-refs.md` registra a limitação e as fontes oficiais consultadas. A imagem comunitária oficial do MinIO também não pôde ser baixada; o fork Silo preserva a API S3 prevista e foi exercitado no teste E2E.
