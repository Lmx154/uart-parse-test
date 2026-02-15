from __future__ import annotations

from contextlib import asynccontextmanager
import re

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import serial.tools.list_ports

from backend.services.serial_service import SerialTelemetryService

service = SerialTelemetryService()


class OpenSerialRequest(BaseModel):
    port: str = Field(..., description="Serial port path, e.g. /dev/ttyUSB0")
    baudrate: int = Field(115200, ge=1200, le=921600)
    timeout_ms: int | None = Field(
        None,
        ge=1,
        le=60000,
        description="Read timeout in milliseconds. null means no timeout (blocking reads).",
    )


class WriteCommandRequest(BaseModel):
    command: str | None = Field(None, description="Text command, e.g. ARM")
    hex_data: str | None = Field(None, description="Hex bytes to write, e.g. A55A0201ABCD")


ALLOWED_TEXT_COMMANDS = {"ARM", "DISARM", "RTL", "HOLD"}


def _normalize_hex_payload(raw: str) -> str:
    # Accept common CLI-style hex formats:
    # - A55A0201ABCD
    # - A5 5A 02 01 AB CD
    # - 0xA5 0x5A 0x02 0x01 0xAB 0xCD
    compact = re.sub(r"[\s,;:_-]+", "", raw.strip())
    compact = re.sub(r"0x", "", compact, flags=re.IGNORECASE)
    if not compact:
        raise HTTPException(status_code=400, detail="hex_data is empty")
    if len(compact) % 2 != 0:
        raise HTTPException(status_code=400, detail="hex_data must contain an even number of hex characters")
    if re.search(r"[^0-9a-fA-F]", compact):
        raise HTTPException(status_code=400, detail="hex_data contains non-hex characters")
    return compact


def _normalize_text_command(raw: str) -> str:
    command = raw.strip().upper()
    if not command:
        raise HTTPException(status_code=400, detail="command is empty")
    if command not in ALLOWED_TEXT_COMMANDS:
        allowed = ", ".join(sorted(ALLOWED_TEXT_COMMANDS))
        raise HTTPException(status_code=400, detail=f"Unsupported command '{command}'. Allowed: {allowed}")
    return command


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await service.shutdown()


app = FastAPI(title="UART Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/serial/status")
async def serial_status() -> dict[str, object]:
    return service.status()


@app.get("/serial/ports")
async def list_serial_ports() -> dict[str, list[dict[str, str]]]:
    ports = sorted(serial.tools.list_ports.comports(), key=lambda port: port.device)
    return {
        "ports": [
            {
                "value": port.device,
                "label": f"{port.device} - {port.description}",
                "device": port.device,
                "description": port.description,
                "hwid": port.hwid,
            }
            for port in ports
        ]
    }


@app.post("/serial/open")
async def open_serial(request: OpenSerialRequest) -> dict[str, object]:
    try:
        timeout_seconds = None if request.timeout_ms is None else request.timeout_ms / 1000.0
        await service.open(port=request.port, baudrate=request.baudrate, timeout_seconds=timeout_seconds)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return service.status()


@app.post("/serial/close")
async def close_serial() -> dict[str, object]:
    await service.close()
    return service.status()


@app.post("/serial/write")
async def write_serial(request: WriteCommandRequest) -> dict[str, int]:
    has_command = request.command is not None
    has_hex = request.hex_data is not None
    if has_command and has_hex:
        raise HTTPException(status_code=400, detail="Provide either command or hex_data, not both")
    if not has_command and not has_hex:
        raise HTTPException(status_code=400, detail="Provide command or hex_data")

    try:
        if has_command:
            command = _normalize_text_command(request.command or "")
            written = await service.write_bytes((command + "\n").encode("ascii"))
        else:
            hex_data = _normalize_hex_payload(request.hex_data or "")
            written = await service.write_hex(hex_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid hex_data: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"written": written}


@app.get("/mavlink/parameters")
async def mavlink_parameters(timeout_s: float = Query(10.0, gt=0.1, le=60.0)) -> dict[str, object]:
    try:
        return await service.fetch_mavlink_parameters(timeout_seconds=timeout_s)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    await service.register_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await service.unregister_client(websocket)
    except Exception:
        await service.unregister_client(websocket)
