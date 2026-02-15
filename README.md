# UART Parser + Local Backend

This project now contains:

- A CLI UART decoder (`main.py`)
- A FastAPI backend for local web UI control and telemetry streaming (`backend/`)

Frame format:

`[0xA5, 0x5A] [len] [packet_type + payload] [crc16_le]`

CRC16-CCITT (`init=0xFFFF`, `poly=0x1021`) is computed over `len + packet_bytes`.

## Install (UV)

```bash
uv sync
```

## Run the backend

```bash
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

## Backend API

- `POST /serial/open`
  - Body: `{"port":"/dev/ttyUSB0","baudrate":115200}`
- `POST /serial/close`
- `POST /serial/write`
  - Body: `{"hex_data":"A55A0201ABCD"}` (raw bytes in hex)
- `GET /serial/ports`
  - Returns dropdown-friendly options: `{"ports":[{"value":"/dev/ttyUSB0","label":"/dev/ttyUSB0 - USB Serial", ...}]}`
- `GET /serial/status`
- `GET /health`
- `WS /ws/telemetry`
  - Broadcasts frame events while serial is open.
  - Each event includes:
    - `decoded` (human-readable string),
    - `parsed` (structured fields for the packet),
    - `telemetry` (normalized realtime metrics for frontend use).

## Front-end toggle model

- Toggle ON: call `POST /serial/open`, then connect websocket `ws://127.0.0.1:8000/ws/telemetry`
- Toggle OFF: call `POST /serial/close`
- Command send: call `POST /serial/write`

## CLI decoder

```bash
uv run main.py --help
```

Useful example:

```bash
uv run main.py -d /dev/ttyUSB0
```
