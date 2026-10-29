#!/usr/bin/env python3
"""One bounded OpenDesign check after the authorized quota reset; no resume."""
from datetime import datetime, timezone
import json
import fcntl
import time

import continue_retained_directory as task

NOT_BEFORE = datetime.fromisoformat('2026-10-28T13:02:15+08:00')
MESSAGE = '仅验证套餐额度重置后的模型调用。只回复 GROVE_QUOTA_OK，不调用工具、不读文件。'


def main():
    now = datetime.now(timezone.utc)
    if now < NOT_BEFORE:
        print(json.dumps({'checked':False, 'reason':'before_authorized_reset',
                          'not_before':NOT_BEFORE.isoformat(), 'model_inference_invoked':False}))
        return 3
    lock = (task.ROOT/'var/collection/opencode-go/queue.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({'checked':False, 'reason':'collector_already_running', 'model_inference_invoked':False}))
        return 4
    engine, workflow = task.engine, task.workflow
    engine.RUN = workflow.RUN = task.RUN
    engine.MODEL = task.MODEL; engine.PROVIDER, engine.MODEL_ID = task.MODEL.split('/',1)
    engine.profile = workflow.profile; engine.TURN_TIMEOUT = 90; engine.TURN_IDLE_TIMEOUT = 60
    common = task.RUN/'common'; task.configure(common)
    folder = task.RUN/'quota-reset-checks'/str(time.time_ns())
    part = folder/'part-000'; (part/'project/notes').mkdir(parents=True)
    (part/'project/data/collections').mkdir(parents=True)
    try:
        receipt = engine.turn_once(part, common, MESSAGE, 'build', 'quota')
        assert receipt['outcome']=='succeeded' and receipt['prompt_verified'] and receipt['stdin_isolated']
        assert receipt['model_actual']['providerID']=='open-design' and receipt['model_actual']['id']=='deepseek-v4.1-flash'
        result = {'checked_at':datetime.now(timezone.utc).isoformat(), 'available':True,
                  'not_before':NOT_BEFORE.isoformat(), 'model':task.MODEL, 'receipt':receipt,
                  'receipt_path':str((part/(receipt['session']+'-run.json')).relative_to(task.ROOT)),
                  'complete_prompt_verified':True, 'queue_started_by_check':False}
        code = 0
    except Exception as exc:
        logs = sorted(part.glob('*.jsonl'))
        result = {'checked_at':datetime.now(timezone.utc).isoformat(), 'available':False,
                  'not_before':NOT_BEFORE.isoformat(), 'model':task.MODEL, 'error_kind':type(exc).__name__,
                  'error':str(exc), 'provider_errors':engine.provider_errors(logs[-1]) if logs else [],
                  'queue_started_by_check':False}
        code = 2
    task.save(folder/'result.json', result)
    task.save(task.RUN/'latest-quota-check.json', result)
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == '__main__': raise SystemExit(main())
