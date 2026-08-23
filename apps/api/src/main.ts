import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const trustProxyHops = config.get<number>('TRUST_PROXY_HOPS', 0);

  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

void bootstrap();
