---
kind: phase
name: phase-03-videos
sources:
  - docs/project-plan.md
  - docs/diagrams/software-arch.mermaid
  - docs/decisions/technical-decisions-phase-03-videos.md
  - docs/phases/phase-02-auth/phase-02-auth.md
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos.

**Capabilities:** storage de originais e thumbnails; upload de até 10 GiB com retomada; rascunho automático; processamento assíncrono; duração/metadados; thumbnail; URL única; streaming parcial e download.

**Deliverables:** API e worker funcionais, serviços no Compose, migration, testes e documentação do processo.

**Affected subprojects:** `nestjs-project/` e `docs/`. **Out of scope:** interface, edição, visibilidade e publicação da Fase 04; player da Fase 05.

**Dependencies:** Fase 01 (Compose, migrations) e Fase 02 (JWT global, usuário/canal). A branch `dev` do repositório base antecede essas fases; esta feature foi criada de `dev` e avançada por fast-forward até `main` para usar a implementação existente.

## Existing conventions

- Backend NestJS 11, TypeORM 0.3, PostgreSQL 17; `AppModule` registra módulos; controller fino, serviço com regras, repository pattern.
- `Channel` é 1:1 com `User`; vídeo referencia `Channel`.
- Guard JWT global e `@Public()` para leitura anônima; filtros de exceção de domínio e validação; Swagger em todos os endpoints.
- Migrations versionadas; `*.spec.ts` unitário, `*.integration-spec.ts` com serviços reais, `*.e2e-spec.ts` via HTTP; comandos Node no container.
- Docker usa nomes de serviços na rede interna.

## Decisions Index

| Ref | Topic | Choice | Capability |
|-----|-------|--------|------------|
| phase-03-videos/TD-01 | Fila | BullMQ/Redis, job idempotente | processamento |
| phase-03-videos/TD-02 | Upload | multipart S3 pré-assinado | 10 GiB/retomada |
| phase-03-videos/TD-03 | Storage | bucket privado, prefixos | originais/thumbnail |
| phase-03-videos/TD-04 | Worker | container separado, ffprobe/ffmpeg | metadados/thumbnail |
| phase-03-videos/TD-05 | URL | UUID v4 com unique | URL única |
| phase-03-videos/TD-06 | Streaming | proxy Range 200/206/416 | reprodução/download |
| phase-03-videos/TD-07 | Estado | draft/processing/ready/error | ciclo/falha/autorização |

## Capability Coverage

| Capability do plano geral | Decisão |
|---------------------------|---------|
| Armazenamento | TD-03 |
| Fila e worker | TD-01, TD-04 |
| Upload 10 GiB e rascunho | TD-02, TD-07 |
| Metadados e thumbnail | TD-04 |
| URL única | TD-05 |
| Streaming e download | TD-06 |

## Resolved integration details

- O navegador recebe URL assinada com endpoint externo configurado; API e worker usam `minio` internamente. O bucket continua privado.
- O serviço Compose `minio` usa Silo, fork comunitário compatível do MinIO, pois a imagem oficial não pôde ser baixada neste ambiente; o protocolo S3 e os endereços previstos permanecem os mesmos.
- O cliente usa partes de 64 MiB, solicita URL por número de parte, guarda ETag e pode repetir uma parte. A API consulta `ListParts`, confere sequência e soma, e só então conclui.
- `CompleteMultipartUpload` e publicação do job não são atômicos; nova chamada de conclusão verifica o objeto existente e tenta publicar novamente. `jobId` fixo e worker idempotente limitam duplicidade.
- `Range` aceita um único intervalo, inclusive forma aberta e sufixo; os bytes são transmitidos com backpressure. Estado não pronto não expõe mídia.
- O caminho local de execução usa um volume para Redis e outro para MinIO. PostgreSQL publica porta alternativa neste workspace por conflito na porta 5432; dentro da rede o host permanece `db:5432`.

## Source boundaries

Todas as capacidades vêm da Fase 03 em `docs/project-plan.md`; visibilidade/publicação e frontend são de fases posteriores. Tamanho de parte, bucket, número de tentativas, rota e campos são decisões de implementação desta fase, especificadas no plano, não novos requisitos de produto.
