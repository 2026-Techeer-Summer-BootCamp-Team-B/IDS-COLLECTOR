"""enrichment.py 단위 테스트 - GeoIP(Redis 필요)는 제외하고, actor_identity 브릿지
로직(2026-07-19, correlation-engine join_on=user_or_sa로 was/waf/falco를 k8s_audit까지
잇기 위한 필드 - rules.py의 _join_key() 주석 참고)만 순수 함수 단위로 검증한다."""
import app.enrichment as enrichment
from app.enrichment import _actor_identity_for_pod, _actor_identity_for_target


class TestActorIdentityForPod:
    def test_exact_deployment_name_matches(self):
        assert _actor_identity_for_pod("juice-shop") == "system:serviceaccount:default:default"

    def test_pod_name_with_replicaset_hash_suffix_matches(self):
        assert (
            _actor_identity_for_pod("juice-shop-75f5f76c8d-nwvcf")
            == "system:serviceaccount:default:default"
        )

    def test_second_target_does_not_collide_with_prefix_of_first(self, monkeypatch):
        """'juice-shop-2-...'가 'juice-shop-'에도 접두사로 걸려버리는 걸 막는지
        확인 - 실제 운영 매핑은 두 타깃이 같은 SA를 써서(우연히) 이 버그가 있어도
        결과가 똑같이 나와 못 잡으므로, 서로 다른 값을 쓰는 가짜 매핑으로
        monkeypatch해서 진짜로 올바른 항목을 골랐는지 확인한다."""
        fake_mapping = {"juice-shop": "sa-A", "juice-shop-2": "sa-B"}
        monkeypatch.setattr(enrichment, "_TARGET_ACTOR_IDENTITY", fake_mapping)
        monkeypatch.setattr(
            enrichment, "_TARGET_NAMES_BY_LENGTH_DESC", sorted(fake_mapping, key=len, reverse=True)
        )
        assert _actor_identity_for_pod("juice-shop-2-df8c5b485-9lt5c") == "sa-B"
        assert _actor_identity_for_pod("juice-shop-75f5f76c8d-nwvcf") == "sa-A"

    def test_backend_pod_matches(self):
        """2026-07-22 회귀 - backend pod가 매핑에서 빠져 있으면 S70/S87처럼 Falco
        stage1이 backend에서 발화하는 시퀀스가 user_or_sa로 k8s_audit과 영원히 join이
        안 된다(SECURITY_TOOLS_TESTING.md 8-0/9 참고)."""
        assert _actor_identity_for_pod("backend") == "system:serviceaccount:default:default"
        assert (
            _actor_identity_for_pod("backend-7d8f9c6b5-x2k9p")
            == "system:serviceaccount:default:default"
        )
        assert (
            _actor_identity_for_pod("backend-2-6c9d8f7b4-p8m3q")
            == "system:serviceaccount:default:default"
        )

    def test_unrelated_pod_returns_none(self):
        assert _actor_identity_for_pod("some-other-workload-abc123") is None

    def test_none_pod_name_returns_none(self):
        assert _actor_identity_for_pod(None) is None

    def test_empty_string_returns_none(self):
        assert _actor_identity_for_pod("") is None


class TestActorIdentityForTarget:
    """WAS/WAF 경로 - Falco의 _actor_identity_for_pod와 대칭."""

    def test_mapped_target_returns_identity(self):
        assert (
            _actor_identity_for_target("juice-shop") == "system:serviceaccount:default:default"
        )

    def test_none_target_name_returns_none(self):
        assert _actor_identity_for_target(None) is None


class TestMissingActorIdentityWarning:
    """매핑에 없는 타깃(2026-07-21 수정 전에는 완전히 조용했다)이 프로세스
    생애주기당 한 번만 경고되는지 확인 - 이벤트마다 찍히면 로그가 도배된다."""

    def setup_method(self):
        enrichment._warned_missing_actor_identity.clear()

    def test_unmapped_target_name_warns_once(self, capsys):
        assert _actor_identity_for_target("unknown-target") is None
        first = capsys.readouterr().out
        assert "actor_identity 매핑 없음" in first
        assert "unknown-target" in first

        # 같은 target_name으로 다시 조회해도 두 번째 경고는 안 찍힌다.
        assert _actor_identity_for_target("unknown-target") is None
        second = capsys.readouterr().out
        assert second == ""

    def test_empty_target_name_does_not_warn(self, capsys):
        # target_name 자체가 없는 건(센서 미설정 등) 이 경고의 대상이 아니다 -
        # "값은 있는데 매핑에 없는" 경우만 경고한다.
        assert _actor_identity_for_target(None) is None
        assert _actor_identity_for_target("") is None
        assert capsys.readouterr().out == ""

    def test_unmapped_falco_pod_warns_once(self, capsys):
        assert _actor_identity_for_pod("some-other-workload-abc123") is None
        first = capsys.readouterr().out
        assert "actor_identity 매핑 없음" in first
        assert "some-other-workload-abc123" in first

        assert _actor_identity_for_pod("some-other-workload-abc123") is None
        second = capsys.readouterr().out
        assert second == ""
