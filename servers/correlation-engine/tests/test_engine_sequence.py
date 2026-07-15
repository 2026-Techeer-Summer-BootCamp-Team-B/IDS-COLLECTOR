"""ScenarioEngine의 sequence 타입 평가 로직 - 실제 app/scenarios/workload.yaml(S1)을
그대로 사용해 stage1 대기/최신 덮어쓰기/stage2 매칭/미완성 시퀀스를 검증한다."""


class TestS1PodExecThenShell:
    async def test_stage1_alone_does_not_fire(self, engine, make_event):
        stage1 = make_event(
            event_module="k8s_audit",
            event_action="create pods/exec",
            orchestrator_resource_name="victim-pod-abc123",
        )
        fired = await engine.evaluate(stage1)
        assert not any(f["scenario_name"].startswith("Pod Exec") for f in fired)

    async def test_stage2_without_prior_stage1_does_not_fire(self, engine, make_event):
        stage2 = make_event(
            event_module="falco",
            event_action="Terminal shell in container",
            orchestrator_resource_name="victim-pod-abc123",
        )
        fired = await engine.evaluate(stage2)
        assert not any(f["scenario_name"].startswith("Pod Exec") for f in fired)

    async def test_stage1_then_stage2_fires_with_both_events(self, engine, make_event):
        pod = "victim-pod-abc123"
        stage1 = make_event(
            event_module="k8s_audit", event_action="get pods/exec",
            orchestrator_resource_name=pod,
        )
        stage2 = make_event(
            event_module="falco", event_action="Contact K8S API Server From Container",
            orchestrator_resource_name=pod,
        )
        await engine.evaluate(stage1)
        fired = await engine.evaluate(stage2)
        hits = [f for f in fired if f["scenario_name"].startswith("Pod Exec")]
        assert len(hits) == 1
        assert hits[0]["join_key"] == pod
        assert [e["event_id"] for e in hits[0]["events"]] == [stage1.event_id, stage2.event_id]
        assert hits[0]["severity"] == 4
        assert hits[0]["mitre_technique_id"] == "T1609"

    async def test_stage1_overwrite_keeps_latest_event(self, engine, make_event):
        """stage1이 대기 중에 또 매칭되면 최신 것으로 덮어쓴다(rules.py 모듈
        docstring의 "stage1 최신 덮어쓰기" 동작)."""
        pod = "victim-pod-abc123"
        stage1_old = make_event(
            event_module="k8s_audit", event_action="create pods/exec",
            orchestrator_resource_name=pod,
        )
        stage1_new = make_event(
            event_module="k8s_audit", event_action="get pods/attach",
            orchestrator_resource_name=pod,
        )
        stage2 = make_event(
            event_module="falco", event_action="Terminal shell in container",
            orchestrator_resource_name=pod,
        )
        await engine.evaluate(stage1_old)
        await engine.evaluate(stage1_new)
        fired = await engine.evaluate(stage2)
        hits = [f for f in fired if f["scenario_name"].startswith("Pod Exec")]
        assert hits[0]["events"][0]["event_id"] == stage1_new.event_id

    async def test_stage2_wrong_action_does_not_match(self, engine, make_event):
        pod = "victim-pod-abc123"
        await engine.evaluate(make_event(
            event_module="k8s_audit", event_action="create pods/exec",
            orchestrator_resource_name=pod,
        ))
        wrong_stage2 = make_event(
            event_module="falco", event_action="Unexpected outbound connection",
            orchestrator_resource_name=pod,
        )
        fired = await engine.evaluate(wrong_stage2)
        assert not any(f["scenario_name"].startswith("Pod Exec") for f in fired)

    async def test_different_pod_does_not_cross_join(self, engine, make_event):
        await engine.evaluate(make_event(
            event_module="k8s_audit", event_action="create pods/exec",
            orchestrator_resource_name="pod-a",
        ))
        stage2_other_pod = make_event(
            event_module="falco", event_action="Terminal shell in container",
            orchestrator_resource_name="pod-b",
        )
        fired = await engine.evaluate(stage2_other_pod)
        assert not any(f["scenario_name"].startswith("Pod Exec") for f in fired)
