from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

import serial
from fastapi import WebSocket

from backend.parser import decode_packet, iter_frames
from backend.services.telemetry_parser import extract_realtime_metrics, parse_packet_fields


class SerialTelemetryService:
    def __init__(self) -> None:
        self._serial: serial.Serial | None = None
        self._serial_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._reader_thread: threading.Thread | None = None

        self._loop: asyncio.AbstractEventLoop | None = None
        self._broadcast_task: asyncio.Task[None] | None = None
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        self._ws_lock = asyncio.Lock()
        self._clients: set[WebSocket] = set()

        self._frame_count = 0
        self._last_tick_ns: int | None = None
        self._port: str | None = None
        self._baudrate: int | None = None

    def is_open(self) -> bool:
        with self._serial_lock:
            return self._serial is not None and self._serial.is_open

    async def open(self, port: str, baudrate: int = 115200) -> None:
        if self.is_open():
            raise RuntimeError("Serial port is already open")

        serial_conn = serial.Serial(port, baudrate=baudrate, timeout=0.2)
        with self._serial_lock:
            self._serial = serial_conn
            self._port = port
            self._baudrate = baudrate

        self._stop_event.clear()
        self._frame_count = 0
        self._last_tick_ns = None

        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        self._reader_thread = threading.Thread(target=self._reader_loop, name="serial-reader", daemon=True)
        self._reader_thread.start()

        if self._broadcast_task is None or self._broadcast_task.done():
            self._broadcast_task = asyncio.create_task(self._broadcast_loop())

    async def close(self) -> None:
        if not self.is_open() and self._reader_thread is None:
            return

        self._stop_event.set()
        with self._serial_lock:
            if self._serial is not None:
                try:
                    self._serial.close()
                finally:
                    self._serial = None

        if self._reader_thread is not None:
            await asyncio.to_thread(self._reader_thread.join, 1.0)
            self._reader_thread = None

        self._port = None
        self._baudrate = None

    async def shutdown(self) -> None:
        await self.close()
        if self._broadcast_task is not None:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass
            self._broadcast_task = None

    async def write_hex(self, hex_data: str) -> int:
        data = bytes.fromhex(hex_data)
        return await self.write_bytes(data)

    async def write_bytes(self, data: bytes) -> int:
        with self._serial_lock:
            serial_conn = self._serial

        if serial_conn is None or not serial_conn.is_open:
            raise RuntimeError("Serial port is not open")

        return await asyncio.to_thread(serial_conn.write, data)

    async def register_client(self, websocket: WebSocket) -> None:
        async with self._ws_lock:
            self._clients.add(websocket)

    async def unregister_client(self, websocket: WebSocket) -> None:
        async with self._ws_lock:
            self._clients.discard(websocket)

    def status(self) -> dict[str, Any]:
        return {
            "is_open": self.is_open(),
            "port": self._port,
            "baudrate": self._baudrate,
            "clients": len(self._clients),
            "frames": self._frame_count,
        }

    def _reader_loop(self) -> None:
        with self._serial_lock:
            serial_conn = self._serial
        if serial_conn is None:
            return

        try:
            for length, payload, expected, received in iter_frames(serial_conn):
                if self._stop_event.is_set():
                    break

                self._frame_count += 1
                crc_ok = expected == received
                packet_type = payload[0] if payload else 0x00
                packet_name, message = decode_packet(payload)
                parsed_fields = parse_packet_fields(payload)
                telemetry = extract_realtime_metrics(packet_name, parsed_fields)

                now_wall = time.time()
                tick_ns = time.perf_counter_ns()
                if self._last_tick_ns is None:
                    dt_ms = None
                    rate_hz = None
                else:
                    dt_ms = (tick_ns - self._last_tick_ns) / 1_000_000.0
                    rate_hz = (1_000.0 / dt_ms) if dt_ms > 0 else None
                self._last_tick_ns = tick_ns

                event = {
                    "ts": now_wall,
                    "frame": self._frame_count,
                    "len": length,
                    "packet_type": packet_type,
                    "packet_name": packet_name,
                    "crc_ok": crc_ok,
                    "decoded": message,
                    "raw_hex": payload.hex(),
                    "dt_ms": dt_ms,
                    "rate_hz": rate_hz,
                }
                if parsed_fields:
                    event["parsed"] = parsed_fields
                if telemetry:
                    event["telemetry"] = telemetry

                if self._loop is not None:
                    self._loop.call_soon_threadsafe(self._queue.put_nowait, event)

        except serial.SerialException as exc:
            if self._loop is not None:
                self._loop.call_soon_threadsafe(
                    self._queue.put_nowait,
                    {
                        "type": "error",
                        "message": f"Serial error: {exc}",
                    },
                )

    async def _broadcast_loop(self) -> None:
        while True:
            event = await self._queue.get()
            async with self._ws_lock:
                clients = list(self._clients)

            if not clients:
                continue

            failed: list[WebSocket] = []
            for client in clients:
                try:
                    await client.send_json(event)
                except Exception:
                    failed.append(client)

            if failed:
                async with self._ws_lock:
                    for client in failed:
                        self._clients.discard(client)
