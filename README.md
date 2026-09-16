# FedOps1 Registry

FedOps1 Tool/LLM/Agent Registry — 독립 서비스(NestJS).

**`FedOps2-Registry`를 포크한 프로젝트다**(2026-08-10). 원본은 Tool·LLM·Agent 카탈로그 조회·발행만 전담하는 서비스였으나(`docs/architecture/architecture-v0.4.md` — 이 문서는 FedOps2 기준이며, 포크 시점 이후 FedOps1 쪽 변경은 반영하지 않는다), FedOps1과 FedOps2의 레지스트리 요구사항이 갈라지면서 이 프로젝트에는 원본에 없는 저장 도메인 두 개가 추가됐다. 아래 "FedOps1 전용 추가 사항" 참고.

## 위치와 경계
- **전용 MongoDB**: Server-Manager의 Task 도메인 MongoDB와 물리적으로 분리된 별도 인스턴스를 쓴다.
- **전용 MinIO**: LLM 바이너리는 Registry 전용 오브젝트 스토리지(`fedops-llms` 버킷)에 저장하고 presigned URL로 배포한다.
- **Task를 모른다**: `source_task_id`/`taskId` 등은 호출자가 이미 검증한 불투명 참조로 취급하고 그대로 저장한다. 실존 검증은 하지 않는다 — Task Assets/Global Models 모듈도 동일 원칙을 따른다.
- **소비 경로**: Console → Backend(BFF) → Registry, 그리고 FedOps2-Client(Agent Studio) → Registry 직접 호출.

## FedOps1 전용 추가 사항 (2026-08-10)

FedOps2에서는 각 Task의 종속파일(`model.py` 등)과 Global 모델을 **Server-Manager 전용 MinIO**가 저장한다(`FedOps2-Server-Manager/src/modules/tasks/task-assets.service.ts`, `eval-assets.service.ts`, `global-model-assets.service.ts`). FedOps1은 이 저장 책임을 이 Registry로 병합하기로 결정했고, 그 결과 아래 두 모듈이 **FedOps2-Registry에는 없는** 이 프로젝트만의 코드로 추가됐다.

| 모듈 | 경로(API) | 버킷(기본값) | 비고 |
|---|---|---|---|
| Task Assets | `/v1/registry/task-assets/:taskId/files[...]` | `fedops-tasks` (`AWS_S3_TASKS_BUCKET`) | `{taskId}/task/` 프리픽스 |
| Global Models | `/v1/registry/global-models/:taskId/files[...]` | `fedops-models` (`AWS_S3_GLOBAL_MODEL_BUCKET`) | `{taskId}/` 프리픽스 |

**FedOps2와의 핵심 차이 — 파일 형식을 제한하지 않는다.** FedOps2의 `TaskAssetsService`는 `.py`/`.yaml`만 허용했지만(태스크 코드가 정형화돼 있다는 전제), FedOps1은 task 종속파일이 정형화돼 있지 않다는 전제이므로 **어떤 파일이든 업로드 가능**하게 구현했다(경로 traversal만 차단). Global Models도 프레임워크별 확장자(`.pt`/`.h5`/`.onnx`/`.bin` 등)가 다양해 동일하게 확장자를 제한하지 않는다.

업로드/다운로드는 요청 본문을 raw stream으로 그대로 주고받는다(JSON으로 감싸지 않음, `PUT`에 `Content-Type: application/octet-stream` 권장) — `FedOps2-Server-Manager`의 `eval-files.controller.ts` 스트리밍 패턴을 그대로 이식했다. `ObjectStorageService`의 `putStream`/`getObjectStream`이 이 패턴을 지원하며, 이 두 메서드도 FedOps2-Registry에는 없다.

**여러 파일 한 번에 업로드 (2026-08-11 추가)**: `POST /v1/registry/task-assets/:taskId/files`, `POST /v1/registry/global-models/:taskId/files`(둘 다 `multipart/form-data`, 필드명 `files` 반복). 단건 `PUT`과 달리 이 라우트는 `multer`(`FilesInterceptor`)로 각 파일을 **메모리에 버퍼링**한다 — 멀티파트를 파싱하면서 동시에 스트리밍하는 건 훨씬 복잡해 배치 업로드에서는 절충했다. 그래서 무제한이 아니다:

| 모듈 | 배치당 파일 수 | 파일당 크기 | 근거 |
|---|---|---|---|
| Task Assets | 20개 | 10MB | 코드 파일은 보통 몇 KB |
| Global Models | 10개 | 50MB | 체크포인트가 클 수 있어 개수를 줄이고 넉넉히 |

이보다 큰 파일은 단건 `PUT`(스트리밍, 메모리 제한 없음)을 쓴다. 배치는 **all-or-nothing** — 파일명 하나라도 잘못됐거나 배치 내 중복이거나 개수 상한을 넘기면 하나도 저장하지 않고 400을 던진다(부분 성공으로 호출자가 반쯤 저장된 상태를 추적하게 만들지 않기 위함).

**Task 전체 ZIP 다운로드 (2026-08-11 추가)**: `GET /v1/registry/tasks/:taskId/archive` — 같은 taskId의 Task 종속파일 + Global 모델 전체를 ZIP 하나로 묶어 내려준다(zip 안 경로는 `task/`, `models/`로 구분해 이름 충돌을 막는다). 새 모듈 `task-archive`가 `task-assets`/`global-models` 두 서비스를 조합하는 상위 레이어로 존재한다 — 두 서비스 자체는 여전히 서로를 모른다("Task를 모른다" 원칙과 별개로, 두 모듈 간 결합도 만들지 않기 위함). `archiver`(스트리밍 zip 라이브러리, v8부터 ESM 전용이라 이 CJS 프로젝트와 호환되는 마지막 버전인 **v7.0.1로 고정**)를 써서 파일을 전부 메모리에 모으지 않고 압축하며 흘려보낸다. 두 도메인 다 파일이 하나도 없으면 404.

두 모듈 모두 Mongo 스키마가 없다(오브젝트 스토리지 프리픽스 소유권만 있는 얇은 레이어) — task 존재 확인도 하지 않는다("Task를 모른다" 원칙).

**Task 삭제 시 자산 정리 API (2026-08-10 추가)**: 각 모듈에 `DELETE /v1/registry/task-assets/:taskId`, `DELETE /v1/registry/global-models/:taskId`(파일 단위가 아니라 taskId 프리픽스 전체 삭제, 파일이 하나도 없어도 204)가 있다. Registry는 Task 삭제 이벤트를 스스로 감지하지 못하므로("Task를 모른다"), 누군가 task 삭제 시 이 두 라우트를 호출해줘야 한다.

> ⚠️ **현재 비활성 (2026-08-10)**: 이 호출자로 FedOps1-Console-Adapter의 `TasksService.remove()`(`src/tasks/registry-client.service.ts`)를 연결해뒀지만, Console-Adapter와 FedOps1-Console을 당장 쓰지 않기로 하면서 **아무도 이 두 라우트를 호출하지 않는다.** task를 지워도 Registry 쪽 자산은 자동으로 정리되지 않으니, 지금은 필요할 때 운영자가 이 두 API를 수동으로 호출하거나, Console-Adapter를 다시 쓰게 될 때/다른 호출자가 생길 때 연결하면 된다. API 자체는 정상 동작한다 — 죽은 건 호출자뿐이다.

**아직 결정되지 않은 것**: Global Models를 Python(Task-FL-Server)의 `S3ModelStore` 직접 쓰기와 병행할지, 이 API로 완전히 대체할지는 FedOps1 클라이언트 작업에서 정한다(이 프로젝트는 저장소 계층만 제공).

## 현재 상태
`tools`/`llms`/`agents` 3개 도메인 모듈(FedOps2-Registry에서 그대로 포크) + `task-assets`/`global-models` 2개 모듈(FedOps1 신규). CRUD·발행·공개/활성 토글까지 정상 동작. `POST /v1/registry/agents/resolve`(Agent Config의 `llm`/`tools` 참조를 실제 엔트리로 조립, 부분성공 허용)도 있다. Dockerfile·Helm 차트(전용 MongoDB/MinIO 포함, 포크 당시 값 그대로 — FedOps1용 재조정 필요)도 존재한다. 원본(FedOps2-Registry)의 남은 갭(LLM 바이너리 업로드 전송 방식 미결 등)은 이 포크에도 그대로 있다 — `docs/future/registry.md` 참고.

## What's inside
- `ConfigModule` + Joi 검증(`src/config/env.validation.ts`), `.env` 기반.
- `MongooseModule.forRootAsync` — Registry 전용 MongoDB 연결.
- URI 버저닝(`/v1/...`, defaultVersion `1`)과 버전 중립 `GET /health`(K8s liveness/readiness probe).
- 글로벌 `ValidationPipe`(whitelist + transform), CORS(`CORS_ORIGINS` 콤마 구분).
- Swagger 문서 `/docs`.
- ESLint 9(flat config) + Prettier + Jest.

## Getting started
1) 의존성 설치: `npm install`
2) 환경 설정: `cp .env.example .env` 후 값 채우기
3) 실행: `npm run start:dev` (로컬) / `npm run build && npm run start:prod`
4) `/docs`로 접속해 기동 확인

## Environment variables
전체 목록과 기본값은 `.env.example`를 참고한다. 접두사 규칙은 워크스페이스 공통 규약(`docs/env-conventions.md`)을 따른다.

| 변수 | 설명 | 기본값 |
|---|---|---|
| `APP_ENV` | 실행 환경 (`development`/`staging`/`production`) | `development` |
| `APP_PORT` | 서버 포트 | `8012` |
| `CORS_ORIGINS` | 허용 출처(콤마 구분), 미설정 시 전체 허용 | – |
| `MONGODB_URI` | Registry 전용 MongoDB URI | `mongodb://localhost:27017` |
| `MONGODB_DATABASE` | 데이터베이스명 | `fedops-registry` |
| `AWS_S3_LLMS_BUCKET` | LLM 바이너리 버킷 | `fedops-llms` |
| `AWS_S3_TASKS_BUCKET` | Task 종속파일 버킷 (FedOps1 전용) | `fedops-tasks` |
| `AWS_S3_GLOBAL_MODEL_BUCKET` | Global 모델 버킷 (FedOps1 전용) | `fedops-models` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 오브젝트 스토리지 자격증명 | – |
| `AWS_DEFAULT_REGION` | SDK 초기화용 리전 값 | `ap-northeast-2` |
| `AWS_S3_ENDPOINT_URL` | 오브젝트 스토리지 엔드포인트(MinIO) | – |

## Next steps
- 클러스터 실배포(Helm 차트는 있으나 아직 적용 전 — `docs/future/server-manager.md` "Registry API 분리" 참고)
- `docs/future/registry.md`의 미룬 기능 3건(LLM 바이너리 업로드, 시그니처 검증, `llm_id` 유니크 인덱스)
- FedOps2-Client Agent Studio가 `POST /v1/registry/agents/resolve`를 소비하도록 재작업(`schemas/agent.py` 등 아직 이전 모양)
