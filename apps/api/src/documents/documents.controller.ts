import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Headers,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileRangeError } from './file-response';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags, ApiQuery, ApiHeader, ApiOperation } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiQuery({
    name: 'q',
    required: false,
    description: '文件名、标题或正文的子串，最多 200 字符。',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    description: '上一页最后一条文档的 id，每页最多 100 条。',
  })
  findAll(@Query('q') q?: string, @Query('after') after?: string) {
    return this.documentsService.findAll(q, after);
  }

  @Get(':id/file')
  @ApiOperation({ summary: '下载原件；preview=1 时使用浏览器打开 PDF' })
  @ApiQuery({
    name: 'preview',
    required: false,
    enum: ['1'],
    description: '仅对 PDF 原件启用 inline 预览。其他格式返回 400。',
  })
  @ApiHeader({
    name: 'Range',
    required: false,
    description: '单一字节范围，例如 bytes=0-1023；无效范围返回 416。',
  })
  async file(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Query('preview') preview: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const file = await this.documentsService.file(id, range, preview === '1');
      response.status(file.partial ? 206 : 200);
      response.setHeader('Accept-Ranges', 'bytes');
      if (file.partial)
        response.setHeader(
          'Content-Range',
          `bytes ${file.offset}-${file.offset + file.length - 1}/${file.size}`,
        );
      if (preview === '1')
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
      return new StreamableFile(file.stream, {
        type: file.type,
        disposition: file.disposition,
        length: file.length,
      });
    } catch (error) {
      if (error instanceof FileRangeError)
        response.setHeader('Content-Range', `bytes */${error.size}`);
      throw error;
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 } }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.documentsService.upload(file);
  }
}
