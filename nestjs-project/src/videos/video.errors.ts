import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Vídeo não encontrado');
  }
}

export class VideoForbiddenException extends DomainException {
  constructor() {
    super('VIDEO_FORBIDDEN', 403, 'Acesso negado ao vídeo');
  }
}

export class VideoAuthenticationException extends DomainException {
  constructor() {
    super('VIDEO_AUTH_REQUIRED', 401, 'Autenticação necessária');
  }
}

export class VideoInvalidStateException extends DomainException {
  constructor() {
    super(
      'VIDEO_INVALID_STATE',
      409,
      'Estado do vídeo não permite esta operação',
    );
  }
}

export class VideoInvalidUploadException extends DomainException {
  constructor() {
    super('VIDEO_INVALID_UPLOAD', 400, 'Upload incompleto ou inválido');
  }
}

export class VideoInvalidRangeException extends DomainException {
  constructor(public readonly size: number) {
    super('VIDEO_INVALID_RANGE', 416, 'Intervalo de bytes inválido');
  }
}

export class VideoStorageUnavailableException extends DomainException {
  constructor() {
    super('VIDEO_STORAGE_UNAVAILABLE', 503, 'Storage indisponível');
  }
}

export class VideoQueueUnavailableException extends DomainException {
  constructor() {
    super('VIDEO_QUEUE_UNAVAILABLE', 503, 'Fila indisponível');
  }
}
