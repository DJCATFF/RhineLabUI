import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { InfrastructureService } from '../documents/infrastructure.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly infra: InfrastructureService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async check() {
    const probes = {
      database: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.infra.redis.ping(),
      storage: () => this.infra.storage.listBuckets(),
      tika: async () => {
        const response = await fetch(`${this.config.getOrThrow<string>('TIKA_URL')}/version`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('Tika unavailable');
        await response.text();
      },
    };
    const checks = Object.fromEntries(
      await Promise.all(
        Object.entries(probes).map(async ([name, probe]) => {
          let timer: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              probe(),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), 4000);
              }),
            ]);
            return [name, 'ok'];
          } catch {
            return [name, 'unavailable'];
          } finally {
            clearTimeout(timer);
          }
        }),
      ),
    );
    const status = Object.values(checks).every((value) => value === 'ok') ? 'ok' : 'degraded';
    const result = { status, checks, timestamp: new Date().toISOString() };
    if (status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
