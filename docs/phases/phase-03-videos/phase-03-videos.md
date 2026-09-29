---
kind: phase
name: phase-03-videos
status: ready
validation: clean
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar upload direto multipart até 10 GiB, processamento fora da API, armazenamento privado, URL única, streaming parcial e download. Fonte de produto: `docs/project-plan.md`, Fase 03. Decisões: `docs/decisions/technical-decisions-phase-03-videos.md`.

## Step Implementations

### SI-03.1 — Fundação Codex, dependências e infraestrutura

**Description:** Portar instruções/skills/MCP para Codex, instalar bibliotecas do `library-refs.md`, subir Redis, MinIO, bootstrap de bucket e worker no Compose. Corrigir a falha pré-existente do teste de migrations, necessária para a suíte completa verde.

**Technical actions:**
- Manter `CLAUDE.md` e expor `AGENTS.md` como link; `.agents/skills` aponta às skills existentes. `.codex/config.toml` configura Context7 e PostgreSQL sem segredos.
- Adicionar `redis` com volume/AOF; serviço S3 `minio` com volume e healthcheck (imagem Silo, fork compatível do MinIO); serviço `minio-init` idempotente cria bucket privado; `video-worker` executa bootstrap próprio em imagem com FFmpeg. A API e o worker usam `db`, `redis`, `minio`.
- Configurar variáveis de storage/fila e validação Joi, sem versionar credenciais. Porta PostgreSQL externa alternativa apenas neste workspace; interna continua 5432.
- Corrigir o teste de migrations para limpar o enum criado pela migration e evitar queries concorrentes no mesmo cliente.

**Tests:** Compose saudável; suite existente unit/integração/e2e; `tsc` e lint. **Dependencies:** nenhuma.

**Acceptance criteria:** Redis, MinIO, bucket, worker e API sobem; suíte prévia volta a verde.

### SI-03.2 — Modelo de vídeo e migration

**Description:** Persistir vídeo ligado ao canal e status completo.

**Technical actions:** Criar `Video` com `channel_id` FK, `public_id` UUID único, título, status, tamanho esperado e real, MIME, chave do original e thumbnail, upload ID, duração/dimensões/codecs, erro resumido e timestamps. Índices para canal/status/public_id. Gerar migration TypeORM; testar constraints reais e rollback.

**Tests:** `video.entity.integration-spec.ts`, migration runner. **Dependencies:** SI-03.1.

**Acceptance criteria:** migration cria tabela, FK e unicidade; `draft` é estado inicial.

### SI-03.3 — Início e envio multipart

**Description:** Criar rascunho e expor URL assinada por parte sem transportar bytes na API.

**Technical actions:** Serviço storage encapsula S3 interno/assinador externo; `POST /videos` recebe título, tamanho e MIME, cria vídeo e multipart; se banco falha, aborta multipart. `POST /videos/:publicId/upload/parts` recebe número de parte e devolve URL PUT com expiração; somente dono do canal e `draft`. Limites 1..10 GiB, partes de 64 MiB, 1..160. Retomar parte é permitido.

**Tests:** unit de limites, integração DB + MinIO, e2e de autenticação, autorização, validação e rascunho. **Dependencies:** SI-03.2.

**Acceptance criteria:** URL PUT permite envio direto ao MinIO; API só recebe JSON.

### SI-03.4 — Conclusão e publicação na fila

**Description:** Validar partes reais, fechar multipart e enfileirar job.

**Technical actions:** `POST /videos/:publicId/upload/complete` consulta `ListParts`, confere sequência, ETags e soma exata; fecha upload; `HeadObject` confirma tamanho e atualiza banco. Para retry após falha entre S3 e Redis, aceita objeto já fechado e tenta publicar de novo com `jobId` fixo. Não marca `processing` antes do worker. `DELETE /videos/:publicId/upload` aborta multipart rascunho.

**Tests:** integração MinIO + Redis + DB, e2e do fluxo real e de conclusão repetida. **Dependencies:** SI-03.3.

**Acceptance criteria:** conclusão incompleta falha sem job; objeto completo cria um job lógico; retry recupera falha de fila.

### SI-03.5 — Processamento no worker

**Description:** Worker separado lê original por URL interna, extrai metadados e grava thumbnail.

**Technical actions:** Consumidor BullMQ `video.process` carrega vídeo; transição idempotente `draft → processing`; `ffprobe` retorna duração/container/codec/dimensões; `ffmpeg` extrai JPEG limitado; `PutObject`; transição `ready`. Timeout e código de falha. Tentativas transitórias via BullMQ; ao esgotar, `error`. Reentrada em `ready` termina sem duplicar efeito.

**Tests:** unit da interpretação de probe e estados; integração com Redis/MinIO/DB/FFmpeg e vídeo curto gerado no teste; e2e aguarda `ready`. **Dependencies:** SI-03.4.

**Acceptance criteria:** worker real produz thumbnail e metadados; falha terminal aparece no banco.

### SI-03.6 — Consulta, streaming, thumbnail e download

**Description:** Expor URL estável e transmissão sem buffer integral.

**Technical actions:** `GET /videos/:publicId` retorna metadados; rascunho/erro só ao dono. `GET /videos/:publicId/stream` faz `GetObject` com Range validado e transmite `Body` com backpressure. `GET /videos/:publicId/download` transmite com `attachment`; `GET /videos/:publicId/thumbnail` transmite JPEG. Somente `ready` permite mídia; `@Public()` explícito para leitura de pronto.

**Tests:** unit do parser de Range; e2e de 200, 206, 416, bytes corretos, download e acesso. **Dependencies:** SI-03.5.

**Acceptance criteria:** intervalo retorna 206 sem baixar objeto inteiro; download e thumbnail funcionam pela URL única.

### SI-03.7 — Fechamento e documentação

**Description:** Atualizar Swagger, OpenAPI exportado, instruções Codex/Claude e `progress.md`, revisar todos os critérios de aceite.

**Tests:** `npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit`, `npm run lint`, `docker compose ps`, `git diff --check`. **Dependencies:** SI-03.1–03.6.

**Acceptance criteria:** DoD completa, documentação condizente com código e evidência de testes por SI.

## Technical Specifications

### Data Model

| Campo `videos` | Tipo / regra | Origem |
|-----------------|--------------|--------|
| `id` | UUID PK | persistência |
| `channel_id` | UUID FK `channels.id`, NOT NULL, índice | Fase 02 + plano Fase 03 |
| `public_id` | UUID v4, NOT NULL, UNIQUE | TD-05 |
| `title` | varchar(200), NOT NULL | pré-cadastro |
| `status` | enum `draft/processing/ready/error`, default draft | TD-07 |
| `storage_key` | varchar, NOT NULL, UNIQUE | TD-03 |
| `thumbnail_key` | varchar, nullable | TD-04 |
| `upload_id` | varchar, nullable | TD-02 |
| `expected_size`, `size_bytes` | bigint, NOT NULL / nullable | TD-02 |
| `content_type` | varchar(100), NOT NULL | upload/stream |
| `duration_ms`, `width`, `height` | integer nullable | TD-04 |
| `video_codec`, `container_format` | varchar nullable | TD-04 |
| `processing_error` | varchar(200) nullable | TD-07 |
| `created_at`, `updated_at` | timestamp | convenção TypeORM |

`expected_size` e `size_bytes` são convertidos para `number` com cuidado: 10 GiB está abaixo de `Number.MAX_SAFE_INTEGER`.

### API Contracts

| Método/rota | Auth | Entrada | Sucesso | Erros previstos |
|-------------|------|---------|---------|-----------------|
| `POST /videos` | JWT | `{title, sizeBytes, contentType}` | 201 `{publicId,status,partSize,partCount}` | 400, 401, 503 |
| `POST /videos/:id/upload/parts` | dono | `{partNumber}` | 201 `{url,expiresIn}` | 400, 401, 403, 404, 409 |
| `POST /videos/:id/upload/complete` | dono | vazio | 202 `{publicId,status}` | 400, 401, 403, 404, 409, 503 |
| `DELETE /videos/:id/upload` | dono | vazio | 204 | 401, 403, 404, 409 |
| `GET /videos/:id` | pronto público; demais dono | — | 200 metadados sem chave privada/uploadId | 401, 403, 404 |
| `GET /videos/:id/stream` | pronto público | `Range?` | 200/206 bytes, `Content-Range` em 206 | 404, 416 |
| `GET /videos/:id/download` | pronto público | `Range?` | 200/206 bytes, `attachment` | 404, 416 |
| `GET /videos/:id/thumbnail` | pronto público | — | 200 image/jpeg | 404 |

Parâmetro `:id` é o `public_id`. Resposta de 416 envia `Content-Range: bytes */<size>`; Range múltiplo é rejeitado. CORS do MinIO permite PUT do origin configurado e expõe `ETag`; clientes guardam números e ETags para retomada.

### Authorization Matrix

| Operação | Anônimo | Autenticado alheio | Dono do canal |
|----------|---------|--------------------|---------------|
| Criar vídeo | 401 | próprio canal | sim |
| Assinar parte/concluir/abortar | 401 | 403 | sim, se draft |
| Consultar draft/processing/error | 401 | 403 | sim |
| Consultar/stream/download/thumbnail ready | sim | sim | sim |

### Error Catalog

| Código | HTTP | Caso |
|--------|------|------|
| `VIDEO_NOT_FOUND` | 404 | UUID desconhecido / mídia indisponível |
| `VIDEO_FORBIDDEN` | 403 | acesso ao rascunho alheio |
| `VIDEO_INVALID_STATE` | 409 | operação incompatível com estado |
| `VIDEO_INVALID_UPLOAD` | 400 | partes faltantes, tamanho/ETag divergente |
| `VIDEO_INVALID_RANGE` | 416 | Range inválido/insatisfazível |
| `VIDEO_STORAGE_UNAVAILABLE` | 503 | MinIO indisponível |
| `VIDEO_QUEUE_UNAVAILABLE` | 503 | Redis indisponível na publicação |
| `VALIDATION_ERROR` | 400 | DTO inválido, envelope existente |

### Events/Messages

#### `video.process`

**Payload:** `{ "videoId": "uuid" }` — sem URL assinada ou credenciais.

**Producer:** `VideosService.completeUpload`; **Consumer:** `VideoProcessor` no container `video-worker`.

**Trigger:** multipart confirmado em S3 e tamanho validado. **Delivery semantics:** pelo menos uma vez; `jobId=video-<uuid>`, 3 tentativas com backoff exponencial; worker idempotente. Estado passa a `processing` ao iniciar, `ready` após salvar thumbnail/metadados, `error` após falha final. O job não carrega bytes de vídeo.

## Dependency Map

```text
SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7
                 modelo     upload    fila     worker   mídia
```

## Deliverables

- `docs/decisions/technical-decisions-phase-03-videos.md` e os cinco artefatos desta pasta.
- Módulo `videos/`, migration, worker e serviços Redis/MinIO/worker no `compose.yaml`.
- API de upload direto até 10 GiB, metadados/thumbnail, URL única, streaming/download e testes unitários, integração e e2e.
- `AGENTS.md` equivalente ao `CLAUDE.md`, skills e MCP configurados para Codex; documentação de código e DoD atualizadas.
