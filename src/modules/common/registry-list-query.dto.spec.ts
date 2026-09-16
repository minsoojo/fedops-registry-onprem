import { ValidationPipe } from '@nestjs/common';
import { ListToolsQueryDto } from '../tools/dto/list-tools-query.dto';
import { ListLlmsQueryDto } from '../llms/dto/list-llms-query.dto';
import { ListAgentsQueryDto } from '../agents/dto/list-agents-query.dto';

/**
 * main.ts의 전역 ValidationPipe와 **동일한 설정**으로 쿼리 DTO를 통과시켜, 쿼리 스트링이
 * 서비스에 닿기 전에 변질되지 않는지 확인한다 (docs/issues/0008).
 *
 * 이 설정을 그대로 재현하는 것이 이 스펙의 핵심이다 — 문제의 원인이었던
 * `enableImplicitConversion: true`를 빼면 버그가 재현되지 않아 테스트가 통과해버린다.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const transform = (metatype: new () => object, query: Record<string, string>) =>
  pipe.transform(query, { type: 'query', metatype });

describe('RegistryListQueryDto (전역 ValidationPipe 설정 기준)', () => {
  // implicit conversion은 Boolean 대상에 !!value를 쓰고, 이 변환이 커스텀 @Transform보다
  // 먼저 실행된다. publicOnly를 boolean으로 선언하면 'false'가 true로 뒤집힌 채 서비스에
  // 도달해 비공개 항목이 조용히 사라진다 — 문자열로 받는 것이 이 라운드트립을 없앤다.
  it("publicOnly='false'가 true로 뒤집히지 않고 문자열 그대로 유지된다", async () => {
    await expect(
      transform(ListToolsQueryDto, { publicOnly: 'false' }),
    ).resolves.toMatchObject({ publicOnly: 'false' });
  });

  it("publicOnly='true'도 문자열 그대로 유지된다", async () => {
    await expect(
      transform(ListToolsQueryDto, { publicOnly: 'true' }),
    ).resolves.toMatchObject({ publicOnly: 'true' });
  });

  it("publicOnly에 'true'/'false' 외의 값이 오면 400으로 거부한다", async () => {
    await expect(
      transform(ListToolsQueryDto, { publicOnly: 'yes' }),
    ).rejects.toThrow();
    await expect(
      transform(ListToolsQueryDto, { publicOnly: '0' }),
    ).rejects.toThrow();
  });

  // 세 리소스가 같은 공통 DTO를 상속하므로 셋 다 동일하게 동작해야 한다 (§7.1).
  it.each([
    ['tools', ListToolsQueryDto],
    ['llms', ListLlmsQueryDto],
    ['agents', ListAgentsQueryDto],
  ] as const)("%s도 publicOnly='false'를 그대로 유지한다", async (_, dto) => {
    await expect(
      transform(dto, { publicOnly: 'false' }),
    ).resolves.toMatchObject({ publicOnly: 'false' });
  });

  it('page/limit은 숫자로 변환된다', async () => {
    await expect(
      transform(ListToolsQueryDto, { page: '2', limit: '5' }),
    ).resolves.toMatchObject({ page: 2, limit: 5 });
  });

  it('tags는 콤마 문자열이 배열로 쪼개진다', async () => {
    await expect(
      transform(ListToolsQueryDto, { tags: 'vision,mnist' }),
    ).resolves.toMatchObject({ tags: ['vision', 'mnist'] });
  });

  it('선언되지 않은 쿼리는 whitelist로 걸러진다', async () => {
    await expect(
      transform(ListToolsQueryDto, { search: 'x', bogus: 'y' }),
    ).resolves.toEqual({ search: 'x' });
  });
});
