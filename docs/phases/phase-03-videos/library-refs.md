---
kind: phase
name: phase-03-videos
status: resolved
---

# phase-03-videos — Library References

## Versões a fixar

| Componente | Faixa planejada | Papel | Fonte oficial |
|------------|-----------------|-------|---------------|
| `@nestjs/bullmq` | 11.0.5 | integração NestJS 11 | [NestJS Queues](https://docs.nestjs.com/techniques/queues) |
| `bullmq` | 5.81.5 | fila e retry | [BullMQ Guide](https://docs.bullmq.io/guide/jobs/retrying-failing-jobs) |
| `@aws-sdk/client-s3` | 3.1142.0 | operações multipart e streaming | [AWS SDK v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/creating-and-calling-service-objects.html) |
| `@aws-sdk/s3-request-presigner` | 3.1142.0 | URL de parte e de leitura interna | [AWS SDK v3 S3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html) |
| `ffmpeg`/`ffprobe` | versão da imagem do worker | processo externo no container | [ffmpeg](https://ffmpeg.org/ffmpeg.html), [ffprobe](https://ffmpeg.org/ffprobe.html) |
| `pgsty/silo` | `RELEASE.2026-09-16T00-00-00Z` | storage S3 local, fork compatível do MinIO | [Silo](https://github.com/pgsty/silo) |

O `package-lock.json` fixa a versão efetivamente instalada. Não há `fluent-ffmpeg`: `spawn` do Node chama as ferramentas oficiais diretamente, sem shell. O projeto já traz `@nestjs/common` 11, TypeORM 0.3, `class-validator` e Jest; são reutilizados.

## APIs verificadas

- `BullModule.registerQueue`, `@Processor`, `WorkerHost.process` na documentação NestJS 11.
- `Queue.add` com `attempts`, `backoff` e `jobId`; semântica de duplicidade e retry na documentação BullMQ.
- `S3Client.send` para `CreateMultipartUpload`, `UploadPart`, `ListParts`, `CompleteMultipartUpload`, `HeadObject`, `GetObject` e `PutObject`; `getSignedUrl` no pacote de presigner.
- `GetObject(Range)` entrega corpo em stream e responde 206; o corpo precisa ser consumido/fechado para liberar conexão.
- `ffprobe -of json -show_format -show_streams`; `ffmpeg -frames:v 1` com saída JPEG.

## Disponibilidade do Context7

O MCP Context7 não foi exposto nas ferramentas desta sessão. O projeto passa a configurá-lo em `.codex/config.toml` via OAuth, mas a conexão só aparece em uma sessão Codex reiniciada e autenticada. Nesta execução, a verificação foi feita nas páginas oficiais acima. Nenhuma consulta ao Context7 é alegada.
