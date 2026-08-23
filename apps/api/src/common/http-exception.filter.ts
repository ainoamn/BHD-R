import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const code =
      typeof response === 'object' && response && 'code' in response
        ? String(response.code)
        : status === 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_FAILED';
    const message =
      typeof response === 'string'
        ? response
        : typeof response === 'object' && response && 'message' in response
          ? String(response.message)
          : status === 500
            ? 'An unexpected error occurred'
            : 'Request failed';
    void reply.status(status).send({
      error: {
        code,
        message,
        requestId: request.id,
        ...(status < 500 && typeof response === 'object' ? { details: response } : {}),
      },
    });
  }
}
