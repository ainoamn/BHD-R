import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators.js';
import { DatabaseService } from '../database/database.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Get('live') live() {
    return { status: 'ok', service: 'bhd-r-api', timestamp: new Date().toISOString() };
  }
  @Get('ready') async ready() {
    try {
      await this.database.asSystem((transaction) => transaction.execute(sql`select 1`));
      return { status: 'ready', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
