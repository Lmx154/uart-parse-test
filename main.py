#!/usr/bin/env python3
"""
Decode MARV UART frames from a file, device, or stdin.

Frame format:
  [0xA5, 0x5A] [len] [packet_type + payload] [crc16_le]
CRC16-CCITT init 0xFFFF, poly 0x1021 over [len] + [packet_type+payload].
"""

from __future__ import annotations

import argparse
import struct
import sys
import time
from typing import BinaryIO, Iterator, Optional, Tuple, List

import serial
import serial.tools.list_ports

PREAMBLE = b"\xA5\x5A"
CRC_INIT = 0xFFFF
CRC_POLY = 0x1021

PACKET_TYPES = {
    0x00: "KEEPALIVE",
    0x01: "RC_DATA",
    0x02: "COMMAND",
    0x10: "LINK_STATS",
    0x11: "ACK",
    0x12: "TELEMETRY_IMU",
    0x13: "TELEMETRY_BARO",
    0x14: "TELEMETRY_MAG",
    0x15: "TELEMETRY_GPS",
    0x16: "TELEMETRY_SYSTEM",
    0x17: "TELEMETRY_BURST",
}

TELEMETRY_KIND = {
    0: ("IMU", 12),
    1: ("BARO", 6),
    2: ("MAG", 6),
    3: ("GPS", 14),
    4: ("SYSTEM", 5),
}


def crc16_ccitt(data: bytes) -> int:
    crc = CRC_INIT
    for b in data:
        crc ^= (b << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ CRC_POLY) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc & 0xFFFF


def read_exact(stream: BinaryIO, n: int) -> Optional[bytes]:
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def iter_frames(stream: BinaryIO) -> Iterator[Tuple[int, bytes, int, int]]:
    sync = 0
    while True:
        b = stream.read(1)
        if not b:
            return
        byte = b[0]
        if sync == 0:
            if byte == PREAMBLE[0]:
                sync = 1
            continue
        if sync == 1:
            if byte == PREAMBLE[1]:
                len_byte = read_exact(stream, 1)
                if len_byte is None:
                    return
                length = len_byte[0]
                payload = read_exact(stream, length) or b""
                crc_bytes = read_exact(stream, 2)
                if crc_bytes is None or len(payload) != length:
                    return
                received = crc_bytes[0] | (crc_bytes[1] << 8)
                expected = crc16_ccitt(bytes([length]) + payload)
                yield length, payload, expected, received
                sync = 0
            else:
                sync = 1 if byte == PREAMBLE[0] else 0


def decode_command(payload: bytes) -> str:
    if len(payload) < 6:
        return f"COMMAND short len={len(payload)}"
    seq, cmd_id, cmd_payload = struct.unpack_from("<BBI", payload, 0)
    return f"COMMAND seq={seq} cmd_id={cmd_id} payload=0x{cmd_payload:08X}"


def decode_link_stats(payload: bytes) -> str:
    if len(payload) < 5:
        return f"LINK_STATS short len={len(payload)}"
    rssi, snr, lq = struct.unpack_from("<hhB", payload, 0)
    return f"LINK_STATS rssi={rssi} snr={snr} lq={lq}"


def decode_imu(payload: bytes) -> str:
    if len(payload) < 12:
        return f"TELEMETRY_IMU short len={len(payload)}"
    vals = struct.unpack_from("<hhhhhh", payload, 0)
    ax, ay, az, gx, gy, gz = vals
    return f"TELEMETRY_IMU accel=[{ax},{ay},{az}] gyro=[{gx},{gy},{gz}]"


def decode_baro(payload: bytes) -> str:
    if len(payload) < 6:
        return f"TELEMETRY_BARO short len={len(payload)}"
    pressure_pa, temp_c_x10 = struct.unpack_from("<ih", payload, 0)
    return f"TELEMETRY_BARO pressure_pa={pressure_pa} temp_c_x10={temp_c_x10}"


def decode_mag(payload: bytes) -> str:
    if len(payload) < 6:
        return f"TELEMETRY_MAG short len={len(payload)}"
    mx, my, mz = struct.unpack_from("<hhh", payload, 0)
    return f"TELEMETRY_MAG mag=[{mx},{my},{mz}]"


def decode_gps(payload: bytes) -> str:
    if len(payload) < 14:
        return f"TELEMETRY_GPS short len={len(payload)}"
    lat, lon, alt_mm, sats, fix = struct.unpack_from("<iiiBB", payload, 0)
    return f"TELEMETRY_GPS lat={lat} lon={lon} alt_mm={alt_mm} sats={sats} fix={fix}"


def decode_system(payload: bytes) -> str:
    if len(payload) < 5:
        return f"TELEMETRY_SYSTEM short len={len(payload)}"
    vbat_mv = int.from_bytes(payload[0:2], "little")
    temp_c = struct.unpack_from("<b", payload, 2)[0]
    arm_status = payload[3]
    rssi_uplink = struct.unpack_from("<b", payload, 4)[0]
    return (
        f"TELEMETRY_SYSTEM vbat_mv={vbat_mv} temp_c={temp_c} "
        f"arm_status={arm_status} rssi_uplink={rssi_uplink}"
    )


def decode_ack(payload: bytes) -> str:
    if not payload:
        return "ACK short len=0"
    return f"ACK seq={payload[0]}"


def decode_burst(payload: bytes) -> str:
    if len(payload) < 2:
        return f"TELEMETRY_BURST short len={len(payload)}"
    kind = payload[0]
    count = payload[1]
    name, sample_len = TELEMETRY_KIND.get(kind, ("UNKNOWN", 0))
    if sample_len == 0:
        return f"TELEMETRY_BURST kind={kind}({name}) count={count} raw={payload[2:].hex()}"
    samples = []
    offset = 2
    for _ in range(count):
        end = offset + sample_len
        if end > len(payload):
            break
        chunk = payload[offset:end]
        if kind == 0:
            samples.append(decode_imu(chunk))
        elif kind == 1:
            samples.append(decode_baro(chunk))
        elif kind == 2:
            samples.append(decode_mag(chunk))
        elif kind == 3:
            samples.append(decode_gps(chunk))
        elif kind == 4:
            samples.append(decode_system(chunk))
        else:
            samples.append(chunk.hex())
        offset = end
    sample_text = "; ".join(samples) if samples else "no_samples"
    return f"TELEMETRY_BURST kind={name} count={count} {sample_text}"


def decode_packet(payload: bytes) -> str:
    if not payload:
        return "KEEPALIVE"
    packet_type = payload[0]
    body = payload[1:]
    if packet_type == 0x00:
        return "KEEPALIVE"
    if packet_type == 0x01:
        return f"RC_DATA len={len(body)} data={body.hex()}"
    if packet_type == 0x02:
        return decode_command(body)
    if packet_type == 0x10:
        return decode_link_stats(body)
    if packet_type == 0x11:
        return decode_ack(body)
    if packet_type == 0x12:
        return decode_imu(body)
    if packet_type == 0x13:
        return decode_baro(body)
    if packet_type == 0x14:
        return decode_mag(body)
    if packet_type == 0x15:
        return decode_gps(body)
    if packet_type == 0x16:
        return decode_system(body)
    if packet_type == 0x17:
        return decode_burst(body)
    name = PACKET_TYPES.get(packet_type, "UNKNOWN")
    return f"{name} type=0x{packet_type:02X} len={len(body)} data={body.hex()}"


def open_stream(args: argparse.Namespace) -> BinaryIO:
    if args.device:
        # Use pyserial for UART device
        try:
            # Block indefinitely so the reader doesn't time out when idle.
            ser = serial.Serial(args.device, baudrate=115200, timeout=None)
            return ser
        except serial.SerialException as e:
            print(f"Failed to open serial port {args.device}: {e}", file=sys.stderr)
            sys.exit(1)
    if args.file and args.file != "-":
        return open(args.file, "rb")
    # If reading from stdin, check if it's a TTY (interactive terminal)
    if sys.stdin.isatty():
        print("No input provided (stdin is a TTY). Please specify a file, device, or pipe data in.", file=sys.stderr)
        sys.exit(1)
    return sys.stdin.buffer


def main() -> int:

    parser = argparse.ArgumentParser(description="Decode MARV UART frames.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("-f", "--file", help="Read from file (default: stdin).")
    group.add_argument("-d", "--device", help="Read from serial device (auto-detect with --list-ports).")
    parser.add_argument("--list-ports", action="store_true", help="List available serial ports and exit.")
    parser.add_argument(
        "-n",
        "--limit",
        type=int,
        default=0,
        help="Stop after N frames (0 = unlimited).",
    )
    parser.add_argument("--raw", action="store_true", help="Include raw payload hex.")
    args = parser.parse_args()

    if args.list_ports:
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            print("No serial ports found.")
            return 1
        print("Available serial ports:")
        for p in ports:
            print(f"  {p.device}: {p.description}")
        return 0

    stream = open_stream(args)
    count = 0
    last_tick_ns: Optional[int] = None
    try:
        for length, payload, expected, received in iter_frames(stream):
            count += 1
            crc_ok = expected == received
            packet_type = payload[0] if payload else 0x00
            name = PACKET_TYPES.get(packet_type, "UNKNOWN")
            status = "OK" if crc_ok else "BAD_CRC"
            msg = decode_packet(payload)
            now_wall = time.time()
            ts = time.strftime("%H:%M:%S", time.localtime(now_wall))
            ms = int(now_wall * 1000) % 1000
            tick_ns = time.perf_counter_ns()
            if last_tick_ns is None:
                delta_text = "dt=---"
            else:
                dt_ns = tick_ns - last_tick_ns
                dt_ms = dt_ns / 1_000_000.0
                rate_hz = 1_000.0 / dt_ms if dt_ms > 0 else 0.0
                delta_text = f"dt={dt_ms:.3f}ms rate={rate_hz:.1f}Hz"
            last_tick_ns = tick_ns
            line = (
                f"{ts}.{ms:03d} [{count:05d}] len={length} type={name} "
                f"crc={status} {delta_text} :: {msg}"
            )
            print(line)
            if args.raw:
                print(f"  raw={payload.hex()}")
            if args.limit and count >= args.limit:
                break
    finally:
        # Close serial port if used
        if hasattr(stream, 'close') and stream is not sys.stdin.buffer:
            stream.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
