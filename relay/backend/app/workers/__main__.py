"""Standalone worker process: `uv run python -m app.workers`.

Runs the same consumer groups (workflow-engine, audit-logger, retry-worker), SLA monitor and outbox
relay as the API lifespan, without HTTP. Start the API with RUN_WORKERS=false to scale them apart.
"""

import asyncio
import contextlib
import logging
import signal

from app.runtime import Runtime, configure_logging, set_runtime

log = logging.getLogger("relay.workers")


async def main() -> None:
    configure_logging()
    runtime = Runtime(run_workers=True)
    set_runtime(runtime)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError, RuntimeError):  # not supported on Windows
            loop.add_signal_handler(sig, stop.set)
    await runtime.start()
    log.info("RELAY workers running (Ctrl+C to stop)")
    try:
        await stop.wait()
    finally:
        await runtime.stop()
        set_runtime(None)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
