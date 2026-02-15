from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import serial.tools.list_ports

from backend.services.serial_service import SerialTelemetryService

service = SerialTelemetryService()


class OpenSerialRequest(BaseModel):
    port: str = Field(..., description="Serial port path, e.g. /dev/ttyUSB0")
    baudrate: int = Field(115200, ge=1200, le=921600)


class WriteCommandRequest(BaseModel):
    hex_data: str = Field(..., description="Hex bytes to write, e.g. A55A0201ABCD")


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
        await service.open(port=request.port, baudrate=request.baudrate)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return service.status()


@app.post("/serial/close")
async def close_serial() -> dict[str, object]:
    await service.close()
    return service.status()


@app.post("/serial/write")
async def write_serial(request: WriteCommandRequest) -> dict[str, int]:
    hex_data = request.hex_data.strip().replace(" ", "")
    if len(hex_data) % 2 != 0:
        raise HTTPException(status_code=400, detail="hex_data must contain an even number of hex characters")

    try:
        written = await service.write_hex(hex_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid hex_data: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"written": written}


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
