from __future__ import annotations

import json
import logging
import math
import os
import socket
import threading
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("rescue.discovery")


def distance_meters(loc1: dict[str, float] | None, loc2: dict[str, float] | None) -> float | None:
    """Haversine distance in meters between two lat/lon pairs."""
    if not loc1 or not loc2:
        return None
    lat1 = loc1.get("lat")
    lon1 = loc1.get("lon")
    lat2 = loc2.get("lat")
    lon2 = loc2.get("lon")
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return None
    r = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(r * c, 1)


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates forward compass bearing in degrees (0 - 360) from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360.0) % 360.0, 1)


def calculate_cardinal(bearing_deg: float) -> str:
    """Converts a compass bearing into a 16-point cardinal direction string."""
    cardinals = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
    ]
    idx = int((bearing_deg + 11.25) / 22.5) % 16
    return cardinals[idx]



class PeerDiscovery:
    """Offline Wi-Fi LAN / Hotspot peer discovery using UDP broadcast beacons.
    
    Operates completely offline without any internet connection. Each device
    periodically broadcasts its presence (node ID, role, HTTP port, status,
    battery, and GPS coordinates) to the local subnet. Any nearby device on the
    same Wi-Fi or mobile hotspot discovers it and records its physical location.
    """

    def __init__(
        self,
        node_id: str,
        role: str,
        http_port: int = 8000,
        broadcast_port: int = 8888,
        broadcast_interval: float = 3.0,
        peer_ttl: float = 15.0,
    ):
        self.node_id = node_id
        self.role = role
        self.http_port = http_port
        self.broadcast_port = broadcast_port
        self.broadcast_interval = broadcast_interval
        self.peer_ttl = peer_ttl

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._discovered_peers: dict[str, dict[str, Any]] = {}
        self._my_location: dict[str, Any] = {
            "lat": None,
            "lon": None,
            "status": "active" if role != "survivor" else "ok",
            "battery": None,
            "updated_at": None,
        }

        self._broadcast_thread: threading.Thread | None = None
        self._listen_thread: threading.Thread | None = None

    def update_location(
        self,
        lat: float,
        lon: float,
        status: str = "active",
        battery: int | None = None,
    ) -> dict[str, Any]:
        """Update local device's GPS position and status for broadcast."""
        with self._lock:
            self._my_location = {
                "lat": float(lat),
                "lon": float(lon),
                "status": status,
                "battery": battery,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            return dict(self._my_location)

    def get_my_location(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._my_location)

    def get_peers(self) -> list[dict[str, Any]]:
        """Return list of active discovered peers with distance relative to local node."""
        now = time.time()
        with self._lock:
            # Purge expired peers
            stale = [
                nid for nid, p in self._discovered_peers.items()
                if now - p["last_seen_epoch"] > self.peer_ttl
            ]
            for nid in stale:
                del self._discovered_peers[nid]

            my_loc = dict(self._my_location)
            result = []
            for p in self._discovered_peers.values():
                peer_copy = dict(p)
                peer_loc = {"lat": p.get("lat"), "lon": p.get("lon")} if p.get("lat") is not None else None
                peer_copy["distance_m"] = distance_meters(my_loc, peer_loc)
                peer_copy["is_online"] = (now - p["last_seen_epoch"]) <= (self.broadcast_interval * 2.5)
                peer_copy["seconds_ago"] = round(now - p["last_seen_epoch"], 1)
                result.append(peer_copy)

            return sorted(result, key=lambda x: (x.get("distance_m") or 999999, x["node_id"]))

    def start(self) -> None:
        """Start the broadcast and listener background threads."""
        self._stop_event.clear()

        self._listen_thread = threading.Thread(
            target=self._listen_loop,
            name="rescue-peer-listen",
            daemon=True,
        )
        self._listen_thread.start()

        self._broadcast_thread = threading.Thread(
            target=self._broadcast_loop,
            name="rescue-peer-broadcast",
            daemon=True,
        )
        self._broadcast_thread.start()
        logger.info(
            f"PeerDiscovery started on broadcast port {self.broadcast_port} (node: {self.node_id})"
        )

    def stop(self) -> None:
        """Stop all background discovery threads."""
        self._stop_event.set()
        if self._broadcast_thread and self._broadcast_thread.is_alive():
            self._broadcast_thread.join(timeout=1.5)
        if self._listen_thread and self._listen_thread.is_alive():
            self._listen_thread.join(timeout=1.5)
        logger.info("PeerDiscovery stopped.")

    def _listen_loop(self) -> None:
        """Continuously listen for incoming UDP broadcast beacons from peers."""
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.settimeout(1.0)
            sock.bind(("", self.broadcast_port))
        except Exception as exc:
            logger.warning(f"Could not bind UDP discovery listener on port {self.broadcast_port}: {exc}")
            if sock:
                sock.close()
            return

        while not self._stop_event.is_set():
            try:
                data, addr = sock.recvfrom(2048)
                peer_ip = addr[0]
                self._handle_incoming_packet(data, peer_ip)
            except socket.timeout:
                continue
            except Exception as exc:
                if not self._stop_event.is_set():
                    logger.debug(f"UDP listener recv error: {exc}")
                time.sleep(0.2)

        try:
            sock.close()
        except Exception:
            pass

    def _handle_incoming_packet(self, raw_data: bytes, peer_ip: str) -> None:
        try:
            packet = json.loads(raw_data.decode("utf-8"))
        except Exception:
            return

        if packet.get("type") != "rescue_beacon":
            return

        remote_node_id = packet.get("node_id")
        # Ignore our own broadcast
        if not remote_node_id or remote_node_id == self.node_id:
            return

        port = packet.get("port", 8000)
        role = packet.get("role", "survivor")
        lat = packet.get("lat")
        lon = packet.get("lon")
        status = packet.get("status", "active")
        battery = packet.get("battery")
        timestamp = packet.get("timestamp", datetime.now(timezone.utc).isoformat())

        now = time.time()
        peer_data = {
            "node_id": remote_node_id,
            "role": role,
            "ip": peer_ip,
            "port": port,
            "url": f"http://{peer_ip}:{port}",
            "lat": float(lat) if lat is not None else None,
            "lon": float(lon) if lon is not None else None,
            "status": status,
            "battery": battery,
            "timestamp": timestamp,
            "last_seen_epoch": now,
        }

        with self._lock:
            self._discovered_peers[remote_node_id] = peer_data

    def _broadcast_loop(self) -> None:
        """Periodically broadcast local node beacon over UDP to the local subnet."""
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.settimeout(0.5)
        except Exception as exc:
            logger.warning(f"Could not initialize UDP discovery sender: {exc}")
            if sock:
                sock.close()
            return

        # Target addresses to try: generic broadcast, loopback broadcast
        broadcast_targets = [
            ("<broadcast>", self.broadcast_port),
            ("255.255.255.255", self.broadcast_port),
        ]

        while not self._stop_event.is_set():
            with self._lock:
                loc = dict(self._my_location)

            packet = {
                "type": "rescue_beacon",
                "version": 1,
                "node_id": self.node_id,
                "role": self.role,
                "port": self.http_port,
                "lat": loc.get("lat"),
                "lon": loc.get("lon"),
                "status": loc.get("status", "active"),
                "battery": loc.get("battery"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            payload = json.dumps(packet).encode("utf-8")
            for target in broadcast_targets:
                try:
                    sock.sendto(payload, target)
                except Exception:
                    # Ignore expected errors when interface is changing or specific subnet is down
                    pass

            # Sleep in small increments to respond quickly to stop_event
            elapsed = 0.0
            while elapsed < self.broadcast_interval and not self._stop_event.is_set():
                time.sleep(0.2)
                elapsed += 0.2

        try:
            sock.close()
        except Exception:
            pass
