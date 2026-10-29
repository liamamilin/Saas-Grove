#!/usr/bin/env python3
"""Bounded check for an explicitly requested provider; never starts the queue."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import time

import continue_retained_directory as task


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=task.ALLOWED_MODELS, required=True)
    args = parser.parse_args()
    lock = (task.ROOT/'var/collection/opencode-go/queue.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({'checked':False, 'reason':'collector_already_running'}))
        return 4
    engine, workflow = task.engine, task.workflow
    engine.RUN = workflow.RUN = task.RUN
    engine.MODEL = args.model
    engine.PROVIDER, engine.MODEL_ID = args.model.split('/', 1)
    engine.profile = workflow.profile
    engine.TURN_TIMEOUT = 120
    engine.TURN_IDLE_TIMEOUT = 60
    common = task.RUN/'common'
    task.configure(common)
    folder = task.RUN/'provider-checks'/engine.PROVIDER/str(time.time_ns())
    part = folder/'part-000'
    project = part/'project'
    (project/'notes').mkdir(parents=True)
    (project/'data/collections').mkdir(parents=True)
    result = {'model':args.model, 'available':False, 'queue_started_by_check':False,
              'checked_at':datetime.now(timezone.utc).isoformat()}
    try:
        receipt = engine.turn_once(part, common,
            '仅验证指定模型调用。只回复 GROVE_PROVIDER_OK，不调用工具、不读文件。', 'build', 'routecheck')
        result['receipt'] = receipt
        target = project/'notes/provider-check.json'
        expected = {'probe':'grove-provider-selection', 'ok':True}
        message = ('仅验证沙箱文件工具。使用write工具在这个完整路径写入指定JSON，再使用read工具读回：'
                   + str(target) + '\nJSON：' + json.dumps(expected)
                   + '\n只调用write和read，不用shell、不读其他文件。最后回复 GROVE_TOOLS_OK。')
        tools_receipt = engine.turn_once(part, common, message, 'build', 'toolcheck')
        events = []
        for line in (task.ROOT/tools_receipt['log_path']).read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('type') == 'tool_use':
                events.append(event.get('part', {}))
        completed = [e.get('tool') for e in events if e.get('state', {}).get('status') == 'completed']
        content_verified = target.is_file() and task.read(target) == expected
        no_shell = all(e.get('tool') in {'write', 'read'} for e in events)
        result['tool_check'] = {'receipt':tools_receipt, 'completed_tools':completed,
                                'content_verified':content_verified, 'no_shell':no_shell}
        assert completed == ['write', 'read'] and content_verified and no_shell
        result['available'] = True
    except Exception as exc:
        result.update(error_kind=type(exc).__name__, error=str(exc))
    result['finished_at'] = datetime.now(timezone.utc).isoformat()
    task.save(folder/'result.json', result)
    task.save(folder.parent/'latest.json', result)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['available'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
