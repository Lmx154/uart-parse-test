from __future__ import annotations

import struct
from typing import Any

BURST_KINDS: dict[int, tuple[str, int]] = {
    0: ("IMU", 12),
    1: ("BARO", 6),
    2: ("MAG", 6),
    3: ("GPS", 14),
    4: ("SYSTEM", 5),
}


def _parse_command(body: bytes) -> dict[str, Any]:
    if len(body) < 6:
        return {"short_len": len(body)}
    seq, command_id, command_payload = struct.unpack_from("<BBI", body, 0)
    return {
        "seq": seq,
        "command_id": command_id,
        "command_payload": command_payload,
    }


def _parse_link_stats(body: bytes) -> dict[str, Any]:
    if len(body) < 5:
        return {"short_len": len(body)}
    rssi_dbm, snr, link_quality = struct.unpack_from("<hhB", body, 0)
    return {
        "rssi_dbm": rssi_dbm,
        "snr": snr,
        "link_quality": link_quality,
    }


def _parse_imu(body: bytes) -> dict[str, Any]:
    if len(body) < 12:
        return {"short_len": len(body)}
    accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z = struct.unpack_from("<hhhhhh", body, 0)
    return {
        "accel_x": accel_x,
        "accel_y": accel_y,
        "accel_z": accel_z,
        "gyro_x": gyro_x,
        "gyro_y": gyro_y,
        "gyro_z": gyro_z,
    }


def _parse_baro(body: bytes) -> dict[str, Any]:
    if len(body) < 6:
        return {"short_len": len(body)}
    pressure_pa, temp_c_x10 = struct.unpack_from("<ih", body, 0)
    return {
        "pressure_pa": pressure_pa,
        "temp_c_x10": temp_c_x10,
        "temp_c": temp_c_x10 / 10.0,
    }


def _parse_mag(body: bytes) -> dict[str, Any]:
    if len(body) < 6:
        return {"short_len": len(body)}
    mag_x, mag_y, mag_z = struct.unpack_from("<hhh", body, 0)
    return {
        "mag_x": mag_x,
        "mag_y": mag_y,
        "mag_z": mag_z,
    }


def _parse_gps(body: bytes) -> dict[str, Any]:
    if len(body) < 14:
        return {"short_len": len(body)}
    lat_e7, lon_e7, alt_mm, sats, fix = struct.unpack_from("<iiiBB", body, 0)
    return {
        "lat_e7": lat_e7,
        "lon_e7": lon_e7,
        "lat_deg": lat_e7 / 10_000_000.0,
        "lon_deg": lon_e7 / 10_000_000.0,
        "alt_mm": alt_mm,
        "alt_m": alt_mm / 1000.0,
        "sats": sats,
        "fix": fix,
    }


def _parse_system(body: bytes) -> dict[str, Any]:
    if len(body) < 5:
        return {"short_len": len(body)}
    battery_mv = int.from_bytes(body[0:2], "little")
    system_temp_c = struct.unpack_from("<b", body, 2)[0]
    arm_status = body[3]
    rssi_uplink_dbm = struct.unpack_from("<b", body, 4)[0]
    return {
        "battery_mv": battery_mv,
        "system_temp_c": system_temp_c,
        "arm_status": arm_status,
        "rssi_uplink_dbm": rssi_uplink_dbm,
    }


def _parse_ack(body: bytes) -> dict[str, Any]:
    if not body:
        return {"short_len": 0}
    return {"seq": body[0]}


def _parse_burst(body: bytes) -> dict[str, Any]:
    if len(body) < 2:
        return {"short_len": len(body)}

    kind_id = body[0]
    count = body[1]
    kind_name, sample_len = BURST_KINDS.get(kind_id, ("UNKNOWN", 0))

    if sample_len == 0:
        return {
            "kind_id": kind_id,
            "kind": kind_name,
            "count": count,
            "sample_len": sample_len,
            "raw_hex": body[2:].hex(),
        }

    samples: list[dict[str, Any]] = []
    offset = 2
    truncated = False

    for _ in range(count):
        end = offset + sample_len
        if end > len(body):
            truncated = True
            break
        chunk = body[offset:end]
        offset = end
        if kind_id == 0:
            sample = _parse_imu(chunk)
        elif kind_id == 1:
            sample = _parse_baro(chunk)
        elif kind_id == 2:
            sample = _parse_mag(chunk)
        elif kind_id == 3:
            sample = _parse_gps(chunk)
        else:
            sample = _parse_system(chunk)
        samples.append(sample)

    return {
        "kind_id": kind_id,
        "kind": kind_name,
        "count": count,
        "sample_len": sample_len,
        "samples": samples,
        "truncated": truncated,
    }


PARSERS: dict[int, Any] = {
    0x00: lambda _body: {},
    0x02: _parse_command,
    0x10: _parse_link_stats,
    0x11: _parse_ack,
    0x12: _parse_imu,
    0x13: _parse_baro,
    0x14: _parse_mag,
    0x15: _parse_gps,
    0x16: _parse_system,
    0x17: _parse_burst,
}


def parse_packet_fields(payload: bytes) -> dict[str, Any]:
    if not payload:
        return {}

    packet_type = payload[0]
    parser = PARSERS.get(packet_type)
    if parser is None:
        return {"raw_hex": payload[1:].hex()}

    return parser(payload[1:])


def extract_realtime_metrics(packet_name: str, fields: dict[str, Any]) -> dict[str, Any]:
    # Fast path for empty fields.
    if not fields:
        return {}

    if packet_name == "TELEMETRY_BARO":
        return {
            "pressure_pa": fields.get("pressure_pa"),
            "temp_c": fields.get("temp_c"),
        }

    if packet_name == "TELEMETRY_GPS":
        return {
            "lat_deg": fields.get("lat_deg"),
            "lon_deg": fields.get("lon_deg"),
            "alt_m": fields.get("alt_m"),
            "alt_mm": fields.get("alt_mm"),
            "sats": fields.get("sats"),
            "fix": fields.get("fix"),
        }

    if packet_name == "TELEMETRY_SYSTEM":
        return {
            "battery_mv": fields.get("battery_mv"),
            "system_temp_c": fields.get("system_temp_c"),
            "arm_status": fields.get("arm_status"),
            "rssi_uplink_dbm": fields.get("rssi_uplink_dbm"),
        }

    if packet_name == "TELEMETRY_IMU":
        return {
            "accel_x": fields.get("accel_x"),
            "accel_y": fields.get("accel_y"),
            "accel_z": fields.get("accel_z"),
            "gyro_x": fields.get("gyro_x"),
            "gyro_y": fields.get("gyro_y"),
            "gyro_z": fields.get("gyro_z"),
        }

    if packet_name == "TELEMETRY_MAG":
        return {
            "mag_x": fields.get("mag_x"),
            "mag_y": fields.get("mag_y"),
            "mag_z": fields.get("mag_z"),
        }

    if packet_name == "LINK_STATS":
        return {
            "link_rssi_dbm": fields.get("rssi_dbm"),
            "link_snr": fields.get("snr"),
            "link_quality": fields.get("link_quality"),
        }

    if packet_name != "TELEMETRY_BURST":
        return {}

    burst_kind = fields.get("kind")
    samples = fields.get("samples")
    if not isinstance(samples, list) or not samples:
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
        }

    latest = samples[-1]
    if not isinstance(latest, dict):
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
        }

    if burst_kind == "BARO":
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
            "pressure_pa": latest.get("pressure_pa"),
            "temp_c": latest.get("temp_c"),
        }

    if burst_kind == "GPS":
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
            "lat_deg": latest.get("lat_deg"),
            "lon_deg": latest.get("lon_deg"),
            "alt_m": latest.get("alt_m"),
            "alt_mm": latest.get("alt_mm"),
            "sats": latest.get("sats"),
            "fix": latest.get("fix"),
        }

    if burst_kind == "SYSTEM":
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
            "battery_mv": latest.get("battery_mv"),
            "system_temp_c": latest.get("system_temp_c"),
            "arm_status": latest.get("arm_status"),
            "rssi_uplink_dbm": latest.get("rssi_uplink_dbm"),
        }

    if burst_kind == "IMU":
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
            "accel_x": latest.get("accel_x"),
            "accel_y": latest.get("accel_y"),
            "accel_z": latest.get("accel_z"),
            "gyro_x": latest.get("gyro_x"),
            "gyro_y": latest.get("gyro_y"),
            "gyro_z": latest.get("gyro_z"),
        }

    if burst_kind == "MAG":
        return {
            "burst_kind": burst_kind,
            "burst_count": fields.get("count"),
            "mag_x": latest.get("mag_x"),
            "mag_y": latest.get("mag_y"),
            "mag_z": latest.get("mag_z"),
        }

    return {
        "burst_kind": burst_kind,
        "burst_count": fields.get("count"),
    }
