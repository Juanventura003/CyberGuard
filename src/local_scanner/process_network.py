import socket
import time
import psutil


def format_address(address):
    if not address:
        return None, None

    try:
        return address.ip, address.port
    except AttributeError:
        try:
            return address[0], address[1]
        except (IndexError, TypeError):
            return None, None


def get_process_network_connections():
    """Collect accessible TCP and UDP connections."""

    connections = []
    restricted = False

    try:
        raw_connections = psutil.net_connections(kind="inet")
    except (psutil.AccessDenied, PermissionError, OSError):
        raw_connections = []
        restricted = True

    for connection in raw_connections:
        pid = connection.pid

        if pid is None:
            continue

        local_ip, local_port = format_address(
            connection.laddr
        )

        remote_ip, remote_port = format_address(
            connection.raddr
        )

        protocol = (
            "TCP"
            if connection.type == socket.SOCK_STREAM
            else "UDP"
        )

        connections.append({
            "pid": pid,
            "protocol": protocol,
            "local_ip": local_ip,
            "local_port": local_port,
            "remote_ip": remote_ip,
            "remote_port": remote_port,
            "status": connection.status,
        })

    return {
        "connections": connections,
        "total": len(connections),
        "restricted": restricted,
        "last_updated": time.time(),
    }
