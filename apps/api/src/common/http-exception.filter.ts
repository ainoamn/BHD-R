import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiRequest, ApiResponse } from './api-http.js';
import { requestIdOf } from './http-request.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ApiRequest>();
    const reply = http.getResponse<ApiResponse>();
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
    reply.status(status).json({
      error: {
        code,
        message,
        requestId: requestIdOf(request),
        ...(status < 500 && typeof response === 'object' ? { details: response } : {}),
      },
    });
  }
}
