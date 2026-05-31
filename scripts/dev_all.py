from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


DEFAULT_VITE_HOST = "127.0.0.1"
DEFAULT_VITE_PORT = 5173
DEFAULT_WS_HOST = "127.0.0.1"
DEFAULT_WS_PORT = 8765


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Vite app and Python satellite server.")
    parser.add_argument("--vite-host", default=DEFAULT_VITE_HOST)
    parser.add_argument("--vite-port", type=int, default=DEFAULT_VITE_PORT)
    parser.add_argument("--ws-host", default=DEFAULT_WS_HOST)
    parser.add_argument("--ws-port", type=int, default=DEFAULT_WS_PORT)
    return parser.parse_args()


def is_port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.2)
        return probe.connect_ex((host, port)) != 0


def find_free_port(host: str, preferred_port: int, count: int = 20) -> int:
    for port in range(preferred_port, preferred_port + count):
        if is_port_free(host, port):
            return port
    raise RuntimeError(f"No free port found in {preferred_port}..{preferred_port + count - 1}")


def build_node_env() -> dict[str, str]:
    env = os.environ.copy()
    node_dir = Path("C:/Program Files/nodejs")
    if node_dir.exists():
        env["PATH"] = str(node_dir) + os.pathsep + env.get("PATH", "")
    return env


def find_npm(env: dict[str, str]) -> str:
    npm = shutil.which("npm.cmd", path=env.get("PATH")) or shutil.which(
        "npm",
        path=env.get("PATH"),
    )
    if not npm:
        raise RuntimeError("npm was not found. Install Node.js or add npm to PATH.")
    return npm


def start_process(args: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.Popen:
    return subprocess.Popen(args, cwd=cwd, env=env)


def terminate(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    vite_port = find_free_port(args.vite_host, args.vite_port)
    ws_port = find_free_port(args.ws_host, args.ws_port)
    node_env = build_node_env()
    npm = find_npm(node_env)

    python_server = start_process(
        [
            sys.executable,
            str(root / "scripts" / "satellite_ws_server.py"),
            "--host",
            args.ws_host,
            "--port",
            str(ws_port),
        ],
        cwd=root,
    )
    vite_env = node_env.copy()
    vite_env["VITE_SATELLITE_WS_URL"] = f"ws://{args.ws_host}:{ws_port}"
    vite = start_process(
        [
            npm,
            "run",
            "dev",
            "--",
            "--host",
            args.vite_host,
            "--port",
            str(vite_port),
            "--strictPort",
        ],
        cwd=root,
        env=vite_env,
    )

    print("", flush=True)
    print(f"Vite app: http://{args.vite_host}:{vite_port}/", flush=True)
    print(f"Satellite WebSocket: ws://{args.ws_host}:{ws_port}", flush=True)
    print("Press Ctrl+C to stop both processes.", flush=True)

    processes = [python_server, vite]

    def stop_children(_signum: int | None = None, _frame: object | None = None) -> None:
        for process in processes:
            terminate(process)

    signal.signal(signal.SIGINT, stop_children)
    signal.signal(signal.SIGTERM, stop_children)

    try:
        while True:
            for process in processes:
                code = process.poll()
                if code is not None:
                    stop_children()
                    return code
            time.sleep(0.25)
    except KeyboardInterrupt:
        stop_children()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
