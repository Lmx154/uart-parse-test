from __future__ import annotations

import struct
from typing import BinaryIO, Iterator, Optional, Tuple

PREAMBLE = b"\xA5\x5A"
CRC_INIT = 0xFFFF
CRC_POLY = 0x1021

PACKET_TYPES = {
    0x00: "KEEPALIVE",
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
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ CRC_POLY) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc & 0xFFFF


def read_exact(stream: BinaryIO, n_bytes: int) -> Optional[bytes]:
    buf = bytearray()
    while len(buf) < n_bytes:
        chunk = stream.read(n_bytes - len(buf))
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
    ax, ay, az, gx, gy, gz = struct.unpack_from("<hhhhhh", payload, 0)
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
        offset = end

    sample_text = "; ".join(samples) if samples else "no_samples"
    return f"TELEMETRY_BURST kind={name} count={count} {sample_text}"


def decode_packet(payload: bytes) -> tuple[str, str]:
    if not payload:
        return "KEEPALIVE", "KEEPALIVE"

    packet_type = payload[0]
    body = payload[1:]
    packet_name = PACKET_TYPES.get(packet_type, "UNKNOWN")

    if packet_type == 0x00:
        return packet_name, "KEEPALIVE"
    if packet_type == 0x02:
        return packet_name, decode_command(body)
    if packet_type == 0x10:
        return packet_name, decode_link_stats(body)
    if packet_type == 0x11:
        return packet_name, decode_ack(body)
    if packet_type == 0x12:
        return packet_name, decode_imu(body)
    if packet_type == 0x13:
        return packet_name, decode_baro(body)
    if packet_type == 0x14:
        return packet_name, decode_mag(body)
    if packet_type == 0x15:
        return packet_name, decode_gps(body)
    if packet_type == 0x16:
        return packet_name, decode_system(body)
    if packet_type == 0x17:
        return packet_name, decode_burst(body)

    return packet_name, f"UNKNOWN type=0x{packet_type:02X} len={len(body)} data={body.hex()}"
