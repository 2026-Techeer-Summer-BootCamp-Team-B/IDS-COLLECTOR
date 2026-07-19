"""enrichment.py 단위 테스트 - GeoIP(Redis 필요)는 제외하고, actor_identity 브릿지
로직(2026-07-19, correlation-engine join_on=user_or_sa로 was/waf/falco를 k8s_audit까지
잇기 위한 필드 - rules.py의 _join_key() 주석 참고)만 순수 함수 단위로 검증한다."""
import app.enrichment as enrichment
from app.enrichment import _actor_identity_for_pod


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

    def test_unrelated_pod_returns_none(self):
        assert _actor_identity_for_pod("some-other-workload-abc123") is None

    def test_none_pod_name_returns_none(self):
        assert _actor_identity_for_pod(None) is None

    def test_empty_string_returns_none(self):
        assert _actor_identity_for_pod("") is None
