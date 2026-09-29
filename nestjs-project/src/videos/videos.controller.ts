import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { SignPartDto } from './dto/sign-part.dto';
import { VideoRangeExceptionFilter } from './video-range.filter';
import { VideosService } from './videos.service';

const errorSchema = { $ref: getSchemaPath(ApiErrorEnvelope) };

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Iniciar upload de vídeo',
    description:
      'Cria rascunho e upload multipart; arquivo vai direto ao storage.',
  })
  @ApiResponse({ status: 201, description: 'Rascunho e upload criados' })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Sem autenticação',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 503,
    description: 'Storage indisponível',
    schema: errorSchema,
  })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateVideoDto) {
    return this.videos.create(user.sub, dto);
  }

  @Post(':publicId/upload/parts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Assinar parte do upload',
    description: 'Devolve URL PUT temporária para envio direto ao storage.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'URL de parte criada' })
  @ApiResponse({
    status: 400,
    description: 'Parte inválida',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Sem autenticação',
    schema: errorSchema,
  })
  @ApiResponse({ status: 403, description: 'Outro canal', schema: errorSchema })
  @ApiResponse({
    status: 404,
    description: 'Vídeo desconhecido',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Estado inválido',
    schema: errorSchema,
  })
  signPart(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SignPartDto,
  ) {
    return this.videos.signPart(publicId, user.sub, dto.partNumber);
  }

  @Post(':publicId/upload/complete')
  @HttpCode(202)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Concluir upload',
    description: 'Verifica as partes no S3 e agenda o processamento.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 202, description: 'Processamento agendado' })
  @ApiResponse({
    status: 400,
    description: 'Partes inválidas',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Sem autenticação',
    schema: errorSchema,
  })
  @ApiResponse({ status: 403, description: 'Outro canal', schema: errorSchema })
  @ApiResponse({
    status: 404,
    description: 'Vídeo desconhecido',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Estado inválido',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 503,
    description: 'Serviço indisponível',
    schema: errorSchema,
  })
  complete(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videos.complete(publicId, user.sub);
  }

  @Delete(':publicId/upload')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abortar upload',
    description: 'Descarta upload multipart e rascunho.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Upload abortado' })
  @ApiResponse({
    status: 401,
    description: 'Sem autenticação',
    schema: errorSchema,
  })
  @ApiResponse({ status: 403, description: 'Outro canal', schema: errorSchema })
  @ApiResponse({
    status: 404,
    description: 'Vídeo desconhecido',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Estado inválido',
    schema: errorSchema,
  })
  abort(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videos.abort(publicId, user.sub);
  }

  @OptionalAuth()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Consultar vídeo',
    description: 'Vídeo pronto é público; demais estados exigem o dono.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Metadados do vídeo' })
  @ApiResponse({
    status: 401,
    description: 'Sem autenticação',
    schema: errorSchema,
  })
  @ApiResponse({ status: 403, description: 'Outro canal', schema: errorSchema })
  @ApiResponse({
    status: 404,
    description: 'Vídeo desconhecido',
    schema: errorSchema,
  })
  metadata(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.videos.metadata(publicId, user?.sub);
  }

  @Public()
  @Get(':publicId/stream')
  @UseFilters(VideoRangeExceptionFilter)
  @ApiOperation({
    summary: 'Reproduzir vídeo',
    description: 'Transmite bytes do original com suporte a Range/206.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Vídeo completo' })
  @ApiResponse({ status: 206, description: 'Intervalo parcial' })
  @ApiResponse({
    status: 404,
    description: 'Mídia indisponível',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 416,
    description: 'Range inválido',
    schema: errorSchema,
  })
  stream(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.sendMedia(publicId, req, res, false, false);
  }

  @Public()
  @Get(':publicId/download')
  @UseFilters(VideoRangeExceptionFilter)
  @ApiOperation({
    summary: 'Baixar vídeo',
    description: 'Transmite o original como anexo, sem buffer integral.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Arquivo completo' })
  @ApiResponse({ status: 206, description: 'Intervalo parcial' })
  @ApiResponse({
    status: 404,
    description: 'Mídia indisponível',
    schema: errorSchema,
  })
  @ApiResponse({
    status: 416,
    description: 'Range inválido',
    schema: errorSchema,
  })
  download(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.sendMedia(publicId, req, res, false, true);
  }

  @Public()
  @Get(':publicId/thumbnail')
  @ApiOperation({
    summary: 'Obter thumbnail',
    description: 'Transmite o JPEG gerado pelo worker.',
  })
  @ApiParam({ name: 'publicId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Imagem JPEG' })
  @ApiResponse({
    status: 404,
    description: 'Imagem indisponível',
    schema: errorSchema,
  })
  thumbnail(
    @Param('publicId', ParseUUIDPipe) publicId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.sendMedia(publicId, req, res, true, false);
  }

  private async sendMedia(
    publicId: string,
    req: Request,
    res: Response,
    thumbnail: boolean,
    attachment: boolean,
  ): Promise<void> {
    const media = await this.videos.media(
      publicId,
      thumbnail ? undefined : req.header('range'),
      thumbnail,
    );
    res.status(media.partial ? 206 : 200);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Content-Length', media.length.toString());
    res.setHeader('Accept-Ranges', 'bytes');
    if (media.contentRange) {
      res.setHeader('Content-Range', media.contentRange);
    }
    if (attachment) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${publicId}.mp4"`,
      );
    }
    await pipeline(media.body, res);
  }
}
