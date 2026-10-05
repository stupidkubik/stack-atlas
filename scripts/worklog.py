#!/usr/bin/env python3
"""Local development evidence, task statuses and a sanitized Markdown journal."""

import argparse
import fcntl
import json
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STATUSES = {"planned", "in_progress", "review", "verified", "blocked"}
RUN_PATTERN = re.compile(r"\d{8}T\d{6}Z-(?:FP|CW|DP|LM|QA)-\d{2}-[a-f0-9]{8}")


def now():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
        file.write(text)
        temporary = Path(file.name)
    temporary.replace(path)


def save_manifest(path, data):
    atomic_write(path / "manifest.json", json.dumps(data, ensure_ascii=False, indent=2) + "\n")


@contextmanager
def locked(root):
    directory = root / "artifacts"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".worklog.lock").open("a") as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        yield


def task_rows(root):
    rows = {}
    for line in (root / "docs/work/tasks.md").read_text().splitlines():
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        if cells and re.fullmatch(r"(?:FP|CW|DP|LM|QA)-\d{2}", cells[0]):
            if len(cells) != 5 or cells[2] not in STATUSES or cells[0] in rows:
                raise ValueError("Некорректная или повторная строка task board")
            rows[cells[0]] = cells
    if not rows:
        raise ValueError("Task board пуст")
    return rows


def set_task(root, task_id, status, run_id, timestamp):
    path = root / "docs/work/tasks.md"
    lines = path.read_text().splitlines()
    for index, line in enumerate(lines):
        if line.startswith(f"| {task_id} |"):
            cells = task_rows(root)[task_id]
            cells[2:] = [status, run_id, timestamp]
            lines[index] = "| " + " | ".join(cells) + " |"
            atomic_write(path, "\n".join(lines) + "\n")
            return
    raise ValueError("Задача отсутствует в board")


def journal(root, data, action, summary, moment):
    day = moment.astimezone(ZoneInfo("Europe/Belgrade")).date().isoformat()
    path = root / f"docs/work/journal/{day}.md"
    text = path.read_text() if path.exists() else f"# Журнал: {day}\n\nВремя записей — UTC.\n"
    text += f"\n- `{stamp(moment)}` · `{data['taskId']}` · `{action}` · `{data['runId']}`: {summary}\n"
    atomic_write(path, text)


def load_run(root, run_id):
    if not RUN_PATTERN.fullmatch(run_id):
        raise ValueError("Некорректный RUN-ID")
    base = (root / "artifacts/runs").resolve()
    path = (base / run_id).resolve()
    if path.parent != base:
        raise ValueError("Run находится вне artifacts/runs")
    data = json.loads((path / "manifest.json").read_text())
    if data.get("schemaVersion") != 1 or data.get("runId") != run_id:
        raise ValueError("Несовместимый manifest")
    if data.get("closedAt"):
        raise ValueError("Run закрыт; создайте новый start для продолжения")
    if task_rows(root)[data["taskId"]][3] != run_id:
        raise ValueError("Run не является текущим для этой задачи")
    return path, data


def base_commit(root):
    result = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=root, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def execute(args, root=ROOT):
    if not args.action == "status":
        for key in ("summary", "command", "name"):
            value = getattr(args, key, None)
            if value is not None and (not value.strip() or "\n" in value or "\r" in value or len(value) > 1000):
                raise ValueError(f"{key}: нужен непустой очищенный текст одной строки (до 1000 символов)")
    with locked(root):
        rows = task_rows(root)
        moment = now()
        if args.action == "status":
            print("\n".join(f"{task}: {cells[2]}" for task, cells in rows.items()))
            return
        if args.action == "start":
            if args.task not in rows:
                raise ValueError("Неизвестный TASK-ID")
            if rows[args.task][2] == "in_progress":
                raise ValueError("У задачи уже есть открытый run; используйте note/check/finish")
            run_id = f"{moment:%Y%m%dT%H%M%SZ}-{args.task}-{uuid4().hex[:8]}"
            path = root / "artifacts/runs" / run_id
            (path / "evidence").mkdir(parents=True)
            data = {"schemaVersion": 1, "runId": run_id, "taskId": args.task, "environment": args.env,
                    "baseCommit": base_commit(root), "startedAt": stamp(moment), "closedAt": None,
                    "status": "in_progress", "summary": args.summary, "checks": []}
            save_manifest(path, data)
            template = (root / "artifacts/templates/report.md").read_text()
            report = template.replace("TASK-ID", args.task)
            report = report.replace("- Run:", f"- Run: {run_id}")
            report = report.replace("- Environment: fixture / development / production", f"- Environment: {args.env}")
            report = report.replace("- Base commit:", f"- Base commit: {data['baseCommit'] or 'initial/uncommitted'}")
            report = report.replace("- Статус:", "- Статус: in_progress (актуальный статус в manifest.json)")
            atomic_write(path / "report.md", report)
            set_task(root, args.task, "in_progress", run_id, stamp(moment))
            journal(root, data, "start", args.summary, moment)
            print(run_id)
            print(path.relative_to(root))
            return
        path, data = load_run(root, args.run)
        if args.action == "check":
            evidence = None
            if args.evidence:
                file = (path / args.evidence).resolve()
                if Path(args.evidence).is_absolute() or not file.is_relative_to(path.resolve()) or not file.is_file():
                    raise ValueError("Evidence должен быть существующим файлом внутри этого run")
                evidence = file.relative_to(path.resolve()).as_posix()
            data["checks"].append({"name": args.name, "command": args.command, "outcome": args.outcome,
                                   "gate": args.gate, "summary": args.summary, "evidence": evidence,
                                   "recordedAt": stamp(moment)})
            save_manifest(path, data)
            summary = f"{args.name}: {args.outcome}. {args.summary}"
        elif args.action == "finish":
            if args.status == "verified":
                if not args.dod_confirmed or not data["checks"] or any(c["outcome"] != "pass" for c in data["checks"]):
                    raise ValueError("verified требует --dod-confirmed и записанных проверок только с pass")
            data.update(status=args.status, closedAt=stamp(moment), summary=args.summary,
                        dodConfirmed=args.dod_confirmed)
            save_manifest(path, data)
            set_task(root, data["taskId"], args.status, data["runId"], stamp(moment))
            summary = f"{args.status}. {args.summary}"
        else:
            summary = args.summary
        journal(root, data, args.action, summary, moment)
        print(f"{data['taskId']}: {args.action} записано")


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="action", required=True)
    start = commands.add_parser("start")
    start.add_argument("task")
    start.add_argument("--env", choices=["fixture", "development", "production"], default="fixture")
    start.add_argument("--summary", required=True)
    for action in ("note", "check", "finish"):
        command = commands.add_parser(action)
        command.add_argument("run")
        command.add_argument("--summary", required=True)
        if action == "check":
            command.add_argument("--name", required=True)
            command.add_argument("--command", required=True)
            command.add_argument("--outcome", choices=["pass", "fail", "not_run"], required=True)
            command.add_argument("--gate", choices=[f"Q{i:02}" for i in range(1, 20)])
            command.add_argument("--evidence")
        elif action == "finish":
            command.add_argument("--status", choices=["planned", "review", "verified", "blocked"], required=True)
            command.add_argument("--dod-confirmed", action="store_true")
    commands.add_parser("status")
    return result


if __name__ == "__main__":
    try:
        execute(parser().parse_args())
    except (ValueError, KeyError, OSError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        sys.exit(1)
