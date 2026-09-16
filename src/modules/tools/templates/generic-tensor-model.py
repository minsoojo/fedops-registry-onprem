# ⚠️ 동기화 필수 — 이 파일은 두 리포지토리에 같은 내용으로 존재한다:
#      FedOps2-Server-Manager/src/modules/tasks/templates/generic-tensor-model.py
#      FedOps2-Registry/src/modules/tools/templates/generic-tensor-model.py
#    두 사본은 이 주석 블록을 포함해 바이트 단위로 동일해야 한다. 한쪽만 고치지 말 것.
#
#    왜 사본이 두 벌인가: auto 발행 조립은 Server-Manager가 수행하므로(architecture-v0.4.md
#    §5.1) 이 텍스트를 읽어 tool-registry 문서의 model_py_source에 채우는 쪽은
#    Server-Manager다. Registry 쪽 사본은 Tool 소비 단계(Agent Studio)에서 이 계약의 정본
#    문서 역할을 한다. 실제 구현 바디를 채울 때는 반드시 양쪽을 같은 커밋에서 갱신한다.
#
# 플랫폼 제공 제네릭 wrapper — auto 발행 Tool 전용 (architecture-v0.3.md §14.1).
#
# 태스크마다 코드를 새로 생성하지 않는 단일 정적 파일이다. auto 발행 시 이 파일의 소스
# 텍스트가 그대로 tool-registry 문서의 model_py_source 필드로 복사된다. 도메인 전처리나
# 의미 해석(라벨 매핑 등)은 하지 않는다 — 그런 Tool이 필요하면 manual 경로(§14.2)로
# 직접 model.py를 작성해 이 자동 생성분을 override한다.
#
# 이 파일은 FedOps2-Client의 hook_contract.py(AST 전용 정적 검증)를 manual 경로와 동일한
# 기준으로 통과해야 하므로, 시그니처는 FedOps-Launcher-JJ의
# load_model(package_root)/prepare(model, raw_input)/predict(model, prepared_input)
# 계약을 그대로 따른다.
#
# 스캐폴딩 범위: 이 세 함수의 실제 구현 바디는 다음 단계로 미룬다(세션 계획 §7/§19).


def load_model(package_root):
    """package_root에 함께 번들된 원본 task/model.py의 get_model()을 호출하고,
    source_task_id/source_model_version으로 resolve한 체크포인트를 로드해 반환한다.
    """
    raise NotImplementedError(
        "generic-tensor-model.py:load_model — 실제 구현은 다음 단계로 미룸"
    )


def prepare(model, raw_input):
    """tool-manifest.json의 schemas.raw(input_shape/input_dtype)대로 raw_input을
    텐서로 reshape+cast만 수행한다. 도메인 전처리는 하지 않는다.
    """
    raise NotImplementedError(
        "generic-tensor-model.py:prepare — 실제 구현은 다음 단계로 미룸"
    )


def predict(model, prepared_input):
    """forward pass를 실행하고 raw output(예: num_classes 크기의 logits)을 그대로
    반환한다. 라벨 매핑 등 의미 해석은 하지 않는다.
    """
    raise NotImplementedError(
        "generic-tensor-model.py:predict — 실제 구현은 다음 단계로 미룸"
    )
