import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Sync NODE_ENV from APP_ENV — staging/production both map to 'production'
const _appEnv = process.env.APP_ENV ?? 'production';
process.env.NODE_ENV ??=
  _appEnv === 'development' ? 'development' : 'production';

const REQUIRED_ENV_KEYS = ['APP_ENV', 'APP_PORT', 'MONGODB_DATABASE'] as const;

const OPTIONAL_ENV_KEYS = [
  'CORS_ORIGINS',
  'MONGODB_URI',
  'AWS_S3_LLMS_BUCKET',
  'AWS_S3_TASKS_BUCKET',
  'AWS_S3_GLOBAL_MODEL_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_DEFAULT_REGION',
  'AWS_S3_ENDPOINT_URL',
] as const;

const SENSITIVE_ENV_KEYS = new Set([
  'MONGODB_URI',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
]);

function logEnvValidation(configService: ConfigService): void {
  Logger.log('Starting environment validation', 'Bootstrap');

  for (const key of REQUIRED_ENV_KEYS) {
    const value = configService.get<string>(key);
    const isSet = value !== undefined && value !== '';
    if (isSet) {
      Logger.log(`  [required] ${key} is set`, 'Bootstrap');
    } else {
      Logger.error(`  [required] ${key} is missing or empty`, 'Bootstrap');
    }
  }

  for (const key of OPTIONAL_ENV_KEYS) {
    const value = configService.get<string>(key);
    const isSet = value !== undefined && value !== '';
    Logger.log(
      `  [optional] ${key} is ${isSet ? 'set' : 'not set'}`,
      'Bootstrap',
    );
  }
}

function logEnvSummary(configService: ConfigService): void {
  const display = (key: string): string => {
    const value = configService.get<string>(key);
    if (!value) return '(not set)';
    return SENSITIVE_ENV_KEYS.has(key) ? '(set, hidden)' : value;
  };

  Logger.log('Environment validation succeeded', 'Bootstrap');
  Logger.log(`  APP_ENV               : ${display('APP_ENV')}`, 'Bootstrap');
  Logger.log(`  APP_PORT              : ${display('APP_PORT')}`, 'Bootstrap');
  Logger.log(
    `  CORS_ORIGINS          : ${display('CORS_ORIGINS')}`,
    'Bootstrap',
  );
  Logger.log(
    `  MONGODB_URI           : ${display('MONGODB_URI')}`,
    'Bootstrap',
  );
  Logger.log(
    `  MONGODB_DATABASE      : ${display('MONGODB_DATABASE')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_S3_LLMS_BUCKET    : ${display('AWS_S3_LLMS_BUCKET')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_S3_TASKS_BUCKET   : ${display('AWS_S3_TASKS_BUCKET')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_S3_GLOBAL_MODEL_BUCKET : ${display('AWS_S3_GLOBAL_MODEL_BUCKET')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_ACCESS_KEY_ID     : ${display('AWS_ACCESS_KEY_ID')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_SECRET_ACCESS_KEY : ${display('AWS_SECRET_ACCESS_KEY')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_DEFAULT_REGION    : ${display('AWS_DEFAULT_REGION')}`,
    'Bootstrap',
  );
  Logger.log(
    `  AWS_S3_ENDPOINT_URL   : ${display('AWS_S3_ENDPOINT_URL')}`,
    'Bootstrap',
  );
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  logEnvValidation(configService);
  logEnvSummary(configService);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = corsOrigins
    ? corsOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FedOps1 Registry API')
    .setDescription(
      'Tool/LLM/Agent 카탈로그 및 발행 API + Task 종속파일/Global 모델 저장 (FedOps1 전용)',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get<number>('APP_PORT');
  await app.listen(port);
  Logger.log(`Server is running on port ${port}`, 'Bootstrap');
}
bootstrap();
