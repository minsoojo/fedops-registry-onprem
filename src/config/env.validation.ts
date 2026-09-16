import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  APP_ENV: Joi.string()
    .valid('development', 'staging', 'production')
    .default('development'),
  APP_PORT: Joi.number().port().default(8012),
  CORS_ORIGINS: Joi.string().optional(), // comma-separated list
  // Registry 전용 MongoDB — Server-Manager의 Task 도메인 MongoDB와 물리적으로
  // 분리된 별도 인스턴스를 가리킨다 (docs/architecture/architecture-v0.4.md §2)
  MONGODB_URI: Joi.string().optional(),
  MONGODB_DATABASE: Joi.string().default('fedops-registry'),
  // 오브젝트 스토리지 = Registry 전용 MinIO ("S3"는 프로토콜/SDK 이름일 뿐이다.
  // docs/env-conventions.md "AWS_ 접두사인데 AWS를 안 쓴다" 참고)
  AWS_S3_LLMS_BUCKET: Joi.string().default('fedops-llms'),
  // FedOps1 전용 — FedOps2에서 Server-Manager 전용 MinIO가 소유하던 두 버킷을
  // 이 Registry로 병합했다(FedOps2-Registry엔 없다). README 참고.
  AWS_S3_TASKS_BUCKET: Joi.string().default('fedops-tasks'),
  AWS_S3_GLOBAL_MODEL_BUCKET: Joi.string().default('fedops-models'),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  AWS_DEFAULT_REGION: Joi.string().default('ap-northeast-2'),
  // 정본은 AWS_S3_ENDPOINT_URL (docs/env-conventions.md §2).
  AWS_S3_ENDPOINT_URL: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
  AWS_S3_PUBLIC_ENDPOINT_URL: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
});
