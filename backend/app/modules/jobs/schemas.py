"""Jobs module — Pydantic schemas."""

from pydantic import BaseModel


class ProcessJobRequest(BaseModel):
    """Payload sent by the queue to process a job."""

    job_id: str
    generation_mode: str
    config: dict | None = None
