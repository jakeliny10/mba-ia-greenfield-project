---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-29
scope_description: "Backend da Fase 03: upload multipart direto ao storage S3 compatível, fila, worker, streaming e ciclo de vida de vídeos."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

> **Phase:** 03 — Upload e Processamento de Vídeos
> **Status:** Decided
> **Date:** 2026-09-29

## Fontes e limites

- Escopo: [plano geral](../project-plan.md), Fase 03 e pontos de atenção; [arquitetura](../diagrams/software-arch.mermaid). S3 compatível/MinIO já está definido; somente seu uso é decidido aqui.
- APIs: [NestJS Queues](https://docs.nestjs.com/techniques/queues), [BullMQ](https://docs.bullmq.io/guide/jobs/retrying-job), [S3 Multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [limites multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html), [S3 Range GET](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html), [ffprobe](https://ffmpeg.org/ffprobe.html).
- Versões instaladas antes da fase: NestJS 11, TypeORM 0.3, Node 25 no container. As bibliotecas novas serão fixadas no lockfile e registradas em `library-refs.md`.

## TD-01: Fila de processamento

**Context:** O plano geral deixa a fila como TBD. O processamento deve sobreviver ao ciclo de vida das requisições e ter tentativas controladas.

**Options:**

### Option A: BullMQ + Redis
- Jobs persistidos no Redis, produtor na API e consumidor em outro container.
- **Pros:** integração oficial com NestJS, retries/backoff e IDs de job; pouca camada de adaptação.
- **Cons:** adiciona Redis e requer disciplina de idempotência; Redis precisa de volume persistente.

### Option B: RabbitMQ + consumidor AMQP
- Mensagens duráveis, acknowledgements e fila de erro.
- **Pros:** semântica de broker explícita e roteamento flexível.
- **Cons:** integração e observabilidade mais trabalhosas para uma única fila; maior superfície operacional.

**Recommendation:** A — a fila única de processamento combina com BullMQ; o retry e a integração com NestJS reduzem código próprio.

**Decision:** A (BullMQ + Redis). Job `video.process` com `jobId=video-<uuid>`, 3 tentativas e backoff exponencial. Entrega pelo menos uma vez; worker idempotente. Redis com AOF e volume. Ref.: [NestJS](https://docs.nestjs.com/techniques/queues), [BullMQ retry](https://docs.bullmq.io/guide/retrying-failing-jobs), [job IDs](https://docs.bullmq.io/guide/jobs/job-ids).

## TD-02: Upload de até 10 GiB

**Context:** A API não deve receber nem manter em memória o arquivo inteiro, e o cliente deve conseguir retomar partes após falha.

**Options:**

### Option A: Multipart S3 com URLs pré-assinadas por parte
- API cria rascunho e upload multipart; cliente envia partes direto ao MinIO/S3 e conclui pela API.
- **Pros:** API só troca metadados; partes podem ser reenviadas; funciona para 10 GiB.
- **Cons:** cliente precisa controlar partes/ETags; CORS e URL pública do storage precisam de configuração.

### Option B: Upload em chunks através da API
- API transmite chunks ao storage.
- **Pros:** autenticação e rede ficam concentradas na API.
- **Cons:** consome conexões e banda da API durante o envio; contraria a exigência de não impactar a API.

**Recommendation:** A — permite upload direto e retomada sem transferir 10 GiB pela API.

**Decision:** A. Limite inclusivo de 10 GiB (10 × 1024³ bytes), partes de 64 MiB, máximo 160 partes, URL por parte sob demanda e expiração curta. O objeto só é confirmado após `ListParts` verificar partes e soma exata dos bytes; requisição de conclusão é repetível. `uploadId` e tamanho esperado ficam no banco. Upload inacabado pode ser abortado; limpeza automática do bucket fica configurada por regra de lifecycle em produção. Ref.: [visão do multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [limites](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html).

## TD-03: Storage e organização

**Context:** O diagrama já determina storage S3 compatível. A imagem comunitária oficial do MinIO deixou de estar disponível para download neste ambiente; o Compose usa Silo, fork mantido do MinIO com protocolo S3 e formato de dados compatíveis. Isso preserva a arquitetura prevista sem trocar a API de storage. [MinIO](https://github.com/minio/minio), [Silo](https://github.com/pgsty/silo).

**Options:**

### Option A: Bucket privado único com prefixos por canal/vídeo
- `videos/<channelId>/<videoId>/original` e `thumbnails/<videoId>.jpg`.
- **Pros:** configurações simples; chaves estáveis e sem colisão; acesso via API/assinatura.
- **Cons:** políticas de retenção por tipo dependem de prefixos.

### Option B: Buckets privados separados
- Um bucket de originais e outro de thumbnails.
- **Pros:** políticas distintas mais fáceis.
- **Cons:** mais configuração para esta fase.

**Recommendation:** A — um bucket atende o escopo e mantém objetos privados.

**Decision:** A. API usa endpoint interno `minio:9000`; URLs assinadas para o navegador usam endpoint externo configurável, que localmente aponta à porta publicada do serviço Silo. Credenciais vêm de variáveis de ambiente não versionadas. O nome do serviço `minio` preserva os endereços previstos na arquitetura.

## TD-04: Worker, metadados e thumbnail

**Context:** FFmpeg/ffprobe é computacionalmente caro e deve rodar fora do processo da API.

**Options:**

### Option A: Container Node separado com FFmpeg/ffprobe
- Worker Nest dedicado consome BullMQ; ferramentas leem URL assinada interna do original e geram um JPEG pequeno.
- **Pros:** separa CPU e falhas da API; reusa módulos/entidade; evita cópia local de 10 GiB.
- **Cons:** URLs internas expiram e podem demandar nova tentativa; requer imagem com FFmpeg.

### Option B: Processo na API
- Consumidor roda junto da API.
- **Pros:** menos containers.
- **Cons:** competição por CPU/memória e ciclo de vida acoplado.

**Recommendation:** A — isolamento operacional é central para a fase.

**Decision:** A. `ffprobe` extrai duração, dimensões, codec e container; `ffmpeg` captura um frame (em 1 s ou início para vídeos curtos). Processo filho sem shell e com timeout; saída JPEG limitada em memória. Thumbnail enviada ao bucket. Falha terminal grava `error`; tentativas transitórias preservam `processing`. Ref.: [ffprobe](https://ffmpeg.org/ffprobe.html), [ffmpeg](https://ffmpeg.org/ffmpeg.html).

## TD-05: Identificador e URL

**Context:** Cada vídeo precisa de URL estável e sem colisão.

**Options:**

### Option A: UUID v4
- Usar UUID aleatório como identificador da rota e chave única no banco.
- **Pros:** geração local, índice único e colisão desprezível; não exige serviço de IDs.
- **Cons:** URL mais longa que um slug curto.

### Option B: Slug curto aleatório
- Gerar token curto com retry em colisão.
- **Pros:** URL menor.
- **Cons:** lógica de colisão e espaço finito; risco cresce com volume.

**Recommendation:** A — confiabilidade vence economia de caracteres nesta fase.

**Decision:** A. `public_id` UUID v4 exclusivo e índice `UNIQUE`; rota `/videos/:publicId`.

## TD-06: Streaming e download

**Context:** Reprodução deve começar sem download completo; o original permanece privado.

**Options:**

### Option A: Proxy com `Range` pela API
- API faz `GetObject` com `Range` e transmite stream em 200/206.
- **Pros:** URL estável e controle de acesso; contrato HTTP observável em e2e.
- **Cons:** banda passa pela API durante reprodução.

### Option B: Redirecionar para GET S3 pré-assinado
- Storage entrega bytes e responde `Range`.
- **Pros:** tira banda da API.
- **Cons:** URL temporária exposta ao cliente; redirecionamento com Range depende do cliente; contrato HTTP menos direto.

**Recommendation:** A — mantém URL única estável e testa `206` pelo endpoint público.

**Decision:** A. A API faz streaming por pipeline com backpressure e sem buffer integral; somente vídeo `ready` responde. `Range` válido retorna 206 com `Content-Range`, `Accept-Ranges` e `Content-Length`; intervalo inválido retorna 416; GET sem Range retorna 200. Download usa o mesmo stream com `Content-Disposition: attachment`. S3 só aceita um intervalo por GET. Ref.: [GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

## TD-07: Estado, falhas e autorização

**Context:** O upload e a fila cruzam banco, S3 e Redis sem transação distribuída.

**Options:**

### Option A: Rascunho até upload concluído; processando no worker; pronto/erro ao término
- Finalização idempotente enfileira job; worker atualiza estado.
- **Pros:** estado representa o trabalho real; nova chamada de conclusão pode recuperar falha de enfileiramento.
- **Cons:** há janela de consistência eventual entre storage, fila e banco.

### Option B: Processando assim que a API conclui multipart
- API marca antes do worker iniciar.
- **Pros:** estado indica intenção de processamento imediatamente.
- **Cons:** falha ao publicar job pode deixar vídeo preso.

**Recommendation:** A — facilita recuperação sem inventar transação distribuída.

**Decision:** A. `draft → processing → ready/error`; `draft` cobre upload em curso ou aguardando job. Só o dono do canal pode iniciar, assinar partes, concluir ou consultar rascunho/erro. Conteúdo `ready` é acessível sem autenticação, coerente com o acesso anônimo do plano geral; publicação/visibilidade é Fase 04. Requisições repetidas não recriam objetos/jobs. Erro terminal grava código resumido, sem expor dados do processo; eventual erro de Redis na finalização permite retry da mesma chamada.

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Fila | BullMQ + Redis | A |
| TD-02 | Upload | Multipart direto ao S3 | A |
| TD-03 | Storage | Bucket privado com prefixos | A |
| TD-04 | Processamento | Worker isolado com FFmpeg | A |
| TD-05 | URL | UUID v4 único | A |
| TD-06 | Reprodução | Proxy Range pela API | A |
| TD-07 | Estado | Rascunho até job; worker muda estado | A |
