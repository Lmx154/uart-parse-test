# UART Script

A Python script to decode MARV UART frames from a file, serial device, or stdin.

## Description

This tool parses UART frames with a specific format: `[0xA5, 0x5A] [len] [packet_type + payload] [crc16_le]`, using CRC16-CCITT for validation. It supports various packet types including telemetry data (IMU, barometer, magnetometer, GPS, system), commands, acknowledgments, and link statistics.

## Installation

1. Ensure you have Python 3.14 or later installed.
2. Install dependencies:
   ```bash
   pip install -e .
   ```
   Or manually:
   ```bash
   pip install pyserial>=3.5
   ```

## Usage

Run the script with Python:

```bash
python main.py [options]
```

### Options

- `-f, --file FILE`: Read from a file. Use `-` for stdin (default).
- `-d, --device DEVICE`: Read from a serial device (e.g., `/dev/ttyUSB0`).
- `--list-ports`: List available serial ports and exit.
- `-n, --limit N`: Stop after N frames (0 = unlimited, default: 0).
- `--raw`: Include raw payload hex in output.

### Examples

1. **Decode from a file:**
   ```bash
   python main.py -f data.bin
   ```

2. **Decode from a serial device:**
   ```bash
   python main.py -d /dev/ttyACM0
   ```

3. **List available serial ports:**
   ```bash
   python main.py --list-ports
   ```

4. **Decode from stdin with raw output and limit to 10 frames:**
   ```bash
   cat data.bin | python main.py --raw -n 10
   ```

5. **Pipe data into the script:**
   ```bash
   some_command | python main.py
   ```

## Packet Types

The script decodes the following packet types:
- `KEEPALIVE`: Keep-alive packet.
- `RC_DATA`: Remote control data.
- `COMMAND`: Command packets with sequence, ID, and payload.
- `LINK_STATS`: Link statistics (RSSI, SNR, LQ).
- `ACK`: Acknowledgment with sequence number.
- `TELEMETRY_*`: Various telemetry data (IMU, barometer, magnetometer, GPS, system).
- `TELEMETRY_BURST`: Burst of telemetry samples.

Output includes timestamp, frame count, length, packet type, CRC status, and decoded message.