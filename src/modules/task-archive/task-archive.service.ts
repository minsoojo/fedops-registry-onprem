import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import archiver from 'archiver';
import { TaskAssetsService } from '../task-assets/task-assets.service';
import { GlobalModelsService } from '../global-models/global-models.service';

/**
 * `TaskAssetsService`/`GlobalModelsService`를 조합해 taskId 하나의 산출물
 * 전부(task 종속파일 + global 모델)를 ZIP 하나로 묶어 내려준다 — FedOps1 전용.
 *
 * 두 서비스는 서로 몰라야 한다는 원칙(각자 다른 버킷 소유권만 책임)을 지키기 위해,
 * 조합 로직은 이 서비스에만 둔다 — task-assets/global-models 자체는 이 존재를 모른다.
 *
 * `archiver`는 스트리밍 zip 라이브러리다 — 파일들을 한꺼번에 메모리에 모으지 않고
 * 엔트리를 추가하는 족족 압축 스트림으로 흘려보낸다(`ObjectStorageService.putStream`과
 * 같은 이유: 이 API로 다루는 파일 크기를 예측할 수 없다).
 */
@Injectable()
export class TaskArchiveService {
  private readonly logger = new Logger(TaskArchiveService.name);

  constructor(
    private readonly taskAssets: TaskAssetsService,
    private readonly globalModels: GlobalModelsService,
  ) {}

  /**
   * zip 스트림을 만들어 반환한다. 호출자(컨트롤러)가 이 스트림을 응답에 그대로
   * 흘려보낸다. 두 도메인 다 파일이 하나도 없으면 404.
   *
   * zip 안 경로는 `task/{filename}`, `models/{filename}`으로 접두사를 붙여
   * 두 도메인의 파일명이 우연히 겹쳐도 충돌하지 않게 한다.
   */
  async buildArchive(taskId: string): Promise<archiver.Archiver> {
    const [taskFiles, modelFiles] = await Promise.all([
      this.taskAssets.list(taskId),
      this.globalModels.list(taskId),
    ]);

    if (taskFiles.length === 0 && modelFiles.length === 0) {
      throw new NotFoundException(
        `No task assets or global model files found for task '${taskId}'`,
      );
    }

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      // archiver는 파이프 소비 중 에러를 이벤트로만 알린다 — 로그로 남긴다
      // (스트림이 이미 응답으로 흘러가는 중이라 이 시점엔 상태 코드를 바꿀 수 없다).
      this.logger.error(
        `Archive stream failed — task_id=${taskId}: ${err.message}`,
      );
    });

    for (const file of taskFiles) {
      const object = await this.taskAssets.download(taskId, file.name);
      if (object) {
        archive.append(object.stream, { name: `task/${file.name}` });
      }
    }
    for (const file of modelFiles) {
      const object = await this.globalModels.download(taskId, file.name);
      if (object) {
        archive.append(object.stream, { name: `models/${file.name}` });
      }
    }

    // finalize()는 "더 넣을 엔트리 없음"을 알리는 신호일 뿐, 완료를 기다리지 않는다 —
    // 실제 바이트는 호출자가 이 스트림을 소비하기 시작해야 흐른다.
    void archive.finalize();

    this.logger.log(
      `Archive built — task_id=${taskId} task_files=${taskFiles.length} model_files=${modelFiles.length}`,
    );
    return archive;
  }
}
