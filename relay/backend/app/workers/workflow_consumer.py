"""Consumer group `relay-workflow-engine`: applies commands, emits outcome events."""

from app.events.envelope import GROUP_WORKFLOW
from app.events.publisher import EventPublisher
from app.workers.consumer import IdempotentConsumer
from app.workflow.engine import WorkflowEngine


def build_workflow_consumer(publisher: EventPublisher) -> IdempotentConsumer:
    engine = WorkflowEngine(publisher)
    return IdempotentConsumer(GROUP_WORKFLOW, engine.handle, publisher)
