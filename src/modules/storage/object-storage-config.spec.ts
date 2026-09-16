import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from './object-storage.service';

describe('public signing endpoint', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  it('signs the original bucket/key at the public endpoint without network access', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'local-test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'local-test-secret';
    process.env.AWS_EC2_METADATA_DISABLED = 'true';
    const service = new ObjectStorageService(new ConfigService({
      AWS_S3_ENDPOINT_URL: 'http://internal.example.invalid:9000',
      AWS_S3_PUBLIC_ENDPOINT_URL: 'https://objects.example.invalid',
      AWS_DEFAULT_REGION: 'ap-northeast-2',
    }));
    const url = new URL(await service.getPresignedUrl('unchanged-bucket', 'task/model.bin', 60));
    expect(url.origin).toBe('https://objects.example.invalid');
    expect(url.pathname).toBe('/unchanged-bucket/task/model.bin');
  });
});
