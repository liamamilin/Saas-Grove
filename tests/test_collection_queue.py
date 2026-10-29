import json
import hashlib
from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect_directory_go as engine
import continue_directory_beam as continuation


def report(**changes):
    value = {'decision':'content_review_passed', 'findings':[],
             'non_blocking_notes':[], 'leaf_checks':{'alpha':'source checked','beta':'gap recorded'},
             'limits':'No runtime test'}
    value.update(changes)
    return value


class QueueRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        engine.STOP.clear()

    def tearDown(self):
        engine.STOP.clear()
        self.tmp.cleanup()

    def log(self, events):
        path = self.root/'events.jsonl'
        path.write_text(''.join(json.dumps(e)+'\n' for e in events))
        return path

    def text_log(self, *texts):
        return self.log([{'type':'text','part':{'text':s}} for s in texts])

    def test_recorded_503_is_retryable_but_auth_quota_and_unknown_are_not(self):
        actual = {'type':'provider.internal','message':'Upstream request failed: Endpoint is unavailable.','status':503}
        self.assertTrue(engine.transient_transport_failure(self.log([{'type':'error','error':actual}])))
        for status, message in ((503,'quota exceeded'),(429,'ECONNRESET'),(401,'socket connection was closed unexpectedly'),(500,'unknown internal failure')):
            self.assertFalse(engine.transient_transport_failure(self.log([{'type':'error','error':{'status':status,'message':message}}])))

    def test_503_retry_is_bounded_and_keeps_same_task(self):
        with patch.object(engine,'turn_once',side_effect=[engine.TransientProviderError('HTTP 503'),{'ok':True}]) as run, patch.object(engine.STOP,'wait',return_value=False):
            self.assertEqual(engine.turn(self.root,self.root,'public task','review',1),{'ok':True})
            self.assertEqual(run.call_count,2)
            self.assertEqual([c.args[2] for c in run.call_args_list],['public task','public task'])
        with patch.object(engine,'turn_once',side_effect=engine.TransientProviderError('HTTP 503')) as run, patch.object(engine.STOP,'wait',return_value=False):
            with self.assertRaises(engine.TransientProviderError): engine.turn(self.root,self.root,'public task','review',1)
            self.assertEqual(run.call_count,2)

    def test_http_200_truncated_stream_and_following_socket_error_are_temporary(self):
        truncated={'type':'provider.invalid-output','message':'OpenAI Chat stream ended without finish_reason','status':200}
        socket={'type':'unknown','message':'Transport: The socket connection was closed unexpectedly.'}
        for errors in [[truncated],[truncated,socket]]:
            self.assertTrue(engine.transient_transport_failure(self.log(
                [{'type':'error','error':e} for e in errors])))
        for other in [{**truncated,'type':'unknown'}, {**truncated,'status':400},
                      {**truncated,'message':'Invalid JSON response'},
                      {'type':'provider.content-filter','message':'Provider blocked the response'},
                      {'type':'provider.internal','status':402,'message':'insufficient balance'}]:
            errors=[truncated,other] if other['type'] in ['provider.content-filter','provider.internal'] else [other]
            self.assertFalse(engine.transient_transport_failure(self.log(
                [{'type':'error','error':e} for e in errors])))

    def test_exhausted_stream_failure_retains_one_unit_and_continues(self):
        def work(number,*args):
            if number==1:
                raise engine.TransientProviderError('HTTP 200 stream interrupted after bounded retry')
            return {'part':number,'status':'awaiting_final_review'}
        with patch.object(engine,'RUN',self.root),patch.object(engine,'run_part',side_effect=work) as run,patch.object(engine,'queue_status'):
            self.assertTrue(engine.run_queue([1,2],self.root,1))
            self.assertEqual(run.call_count,2)
        state=engine.read(self.root/'part-001/state.json')
        self.assertEqual(state['error_kind'],'transient_provider')
        self.assertEqual(state['status'],'needs_attention')
        self.assertFalse(state['published'])

    def content_block(self, number):
        part=self.root/f'part-{number:03}';project=part/'project'
        project.mkdir(parents=True,exist_ok=True)
        engine.save(project/'input.json',{'leaves':['alpha']})
        engine.save(project/'prepared.json',{'slugs':['alpha'],'input_sha256':engine.sha(project/'input.json')})
        (project/'notes').mkdir(exist_ok=True)
        (project/'notes/existing.txt').write_text('Existing draft and source evidence')
        session=f'ses-retained-{number}'
        log=part/f'{session}.jsonl'
        log.write_text(json.dumps({'type':'error','error':{'type':'provider.content-filter','message':'Provider blocked the response'}})+'\n')
        receipt=part/f'{session}-run.json'
        engine.save(receipt,{'session':session,'role':'build','model_requested':'opencode-go/deepseek-v4.1-flash',
                            'model_actual':{'providerID':'opencode-go','id':'deepseek-v4.1-flash'},
                            'exit_code':1,'outcome':'failed','stdin_isolated':True,'prompt_verified':True,
                            'log_path':str(log.relative_to(self.root))})
        return engine.ContentBlockedError('Provider blocked the response',receipt)

    def test_content_filter_requires_explicit_type_and_no_mixed_account_error(self):
        blocked={'type':'provider.content-filter','message':'Provider blocked the response'}
        self.assertTrue(engine.content_filter_failure(self.log([{'type':'error','error':blocked}])))
        cases=[{'message':'Provider blocked the response'},
               {**blocked,'status':401},{**blocked,'status':429},{**blocked,'message':'quota exceeded'}]
        for error in cases:
            self.assertFalse(engine.content_filter_failure(self.log([{'type':'error','error':error}])))
        mixed=self.log([{'type':'error','error':blocked},{'type':'error','error':{'status':503,'message':'unavailable'}}])
        self.assertFalse(engine.content_filter_failure(mixed))
        self.assertFalse(engine.transient_transport_failure(mixed))

    def test_content_filter_is_not_retried_or_rephrased(self):
        error=self.content_block(1)
        with patch.object(engine,'turn_once',side_effect=error) as run:
            with self.assertRaises(engine.ContentBlockedError):engine.turn(self.root,self.root,'public task','build',1)
            self.assertEqual(run.call_count,1)
            self.assertEqual(run.call_args.args[2],'public task')

    def test_content_filter_dispatch_requires_confirmed_model_and_exact_prompt(self):
        part=self.root/'part-001';(part/'project').mkdir(parents=True)
        message='Public collection task'
        def spawn(*args,**kwargs):
            kwargs['stdout'].write(json.dumps({'type':'error','error':{'type':'provider.content-filter','message':'Provider blocked the response'}})+'\n')
            kwargs['stdout'].flush()
            return SimpleNamespace(pid=-123)
        for actual,text,expected in [(engine.MODEL_ID,message,engine.ContentBlockedError),
                                     ('wrong-model',message,engine.ProviderError),
                                     (engine.MODEL_ID,message+' EXTRA',engine.ProviderError)]:
            data={'info':{'model':{'providerID':engine.PROVIDER,'id':actual},'outcome':'failed'},
                  'messages':[{'type':'user','text':text}]}
            with self.subTest(actual=actual,text=text),patch.object(engine,'ROOT',self.root),patch.object(engine,'profile',return_value=''),patch.object(engine,'config',return_value={}),patch.object(engine,'spawn_tracked',side_effect=spawn),patch.object(engine,'wait_for_cli',return_value=1),patch.object(engine,'run_tracked',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(data))):
                with self.assertRaises(expected) as caught:engine.turn_once(part,self.root,message,'build',1)
                self.assertIs(type(caught.exception),expected)
        self.assertFalse((part/'project/review.json').exists())

    def test_multiple_content_blocks_retain_evidence_and_continue_queue(self):
        errors={n:self.content_block(n) for n in [1,2,3]}
        def work(n,*args):
            if n in errors:raise errors[n]
            return {'part':n,'status':'awaiting_final_review'}
        with patch.object(engine,'ROOT',self.root),patch.object(engine,'RUN',self.root),patch.object(engine,'run_part',side_effect=work) as run,patch.object(engine,'queue_status'):
            self.assertTrue(engine.run_queue([1,2,3,4],self.root,1))
            self.assertEqual(run.call_count,4)
            for n in errors:
                part=self.root/f'part-{n:03}';state=engine.read(part/'state.json')
                self.assertEqual(state['status'],'needs_attention')
                self.assertEqual(state['error_kind'],'content_filter')
                self.assertFalse(state['archived']);self.assertFalse(state['published'])
                engine.verify_content_filter_retention(part,state)
                self.assertEqual((part/'project/notes/existing.txt').read_text(),'Existing draft and source evidence')

    def test_resume_skips_retained_content_block_and_verifies_snapshot(self):
        error=self.content_block(1);part=self.root/'part-001'
        with patch.object(engine,'ROOT',self.root):
            state=engine.retain_content_filter(1,part,error)
        unit={'unit':1,'phase':'repair','parent':1,'slugs':['alpha']}
        with patch.object(continuation,'UNITS',[unit]),patch.object(continuation,'prepare',return_value=part),patch.object(engine,'turn') as run:
            self.assertEqual(continuation.run_unit(1,self.root),state)
            run.assert_not_called()
            (part/'project/notes/existing.txt').write_text('changed')
            with self.assertRaises(AssertionError):continuation.run_unit(1,self.root)
            run.assert_not_called()

    def test_resume_preserves_exhausted_correction_findings_without_new_call(self):
        part=self.root/'part-001';part.mkdir()
        state={'part':1,'status':'needs_attention','reason':'bounded corrections exhausted','runs':['old-review']}
        engine.save(part/'state.json',state)
        with patch.object(continuation,'UNITS',[{'unit':1}]),patch.object(continuation,'prepare',return_value=part),patch.object(engine,'turn') as run:
            self.assertEqual(continuation.run_unit(1,self.root),state)
            run.assert_not_called()

    def test_complete_fenced_and_split_json_reports(self):
        raw=json.dumps(report())
        self.assertEqual(engine.extract_review(self.text_log('```json\n'+raw+'\n```'),['alpha','beta']),report())
        self.assertEqual(engine.extract_review(self.text_log(raw[:50],raw[50:]),['alpha','beta']),report())

    def test_truncation_missing_leaf_and_false_pass_are_rejected(self):
        cases=[json.dumps(report())[:-3],json.dumps(report(leaf_checks={'alpha':'checked'})),
               json.dumps(report(findings=['missing license'])),json.dumps({'decision':'content_review_passed'}),
               json.dumps({'incomplete_response':True,'example':report()})]
        for text in cases:
            with self.subTest(text=text),self.assertRaises(engine.ReviewReportError):
                engine.extract_review(self.text_log(text),['alpha','beta'])

    def test_refusal_is_preserved_and_never_becomes_approval(self):
        with self.assertRaises(engine.ReviewReportError) as raised:
            engine.extract_review(self.text_log('抱歉，我无法协助该请求。'),['alpha','beta'])
        self.assertEqual(raised.exception.kind,'refused')
        error=engine.ReviewReportError(self.root/'original.jsonl','refused')
        with patch.object(engine,'turn_once',side_effect=error) as run:
            with self.assertRaises(engine.ReviewReportError):engine.turn(self.root,self.root,'public review','review',1)
            self.assertEqual(run.call_count,2)
            self.assertTrue(all(c.args[3]=='review' for c in run.call_args_list))
        self.assertFalse((self.root/'review.json').exists())

    def test_format_and_transport_have_separate_finite_budgets(self):
        errors=[engine.TransientProviderError('HTTP 503'),engine.ReviewReportError(self.root/'bad.jsonl','incomplete_or_invalid_json'),{'ok':True}]
        with patch.object(engine,'turn_once',side_effect=errors) as run,patch.object(engine.STOP,'wait',return_value=False):
            self.assertEqual(engine.turn(self.root,self.root,'public task','review',1),{'ok':True})
            self.assertEqual(run.call_count,3)

    def test_stalled_unit_does_not_retry_or_abort_healthy_units(self):
        with patch.object(engine,'turn_once',side_effect=engine.NoProgressError('idle')) as run:
            with self.assertRaises(engine.NoProgressError):engine.turn(self.root,self.root,'public task','review',1)
            self.assertEqual(run.call_count,1)
        def work(n,*args):
            if n==1:raise engine.NoProgressError('idle')
            return {'part':n,'status':'awaiting_final_review'}
        with patch.object(engine,'RUN',self.root),patch.object(engine,'run_part',side_effect=work) as run,patch.object(engine,'queue_status'):
            self.assertTrue(engine.run_queue([1,2,3],self.root,1))
            self.assertEqual(run.call_count,3)
            self.assertEqual(json.loads((self.root/'part-001/state.json').read_text())['error_kind'],'temporary_stall')

    def test_three_stalls_or_one_fatal_provider_error_stop_dispatch(self):
        for error,expected in ((engine.NoProgressError('idle'),3),(engine.ProviderError('unauthorized'),1)):
            with self.subTest(error=error),patch.object(engine,'RUN',self.root),patch.object(engine,'run_part',side_effect=error) as run,patch.object(engine,'queue_status'):
                self.assertFalse(engine.run_queue([1,2,3,4,5],self.root,1))
                self.assertEqual(run.call_count,expected)

    def test_child_does_not_read_inherited_launch_input(self):
        launcher="""import subprocess,sys
import collect_directory_go as e
p=e.spawn_tracked([sys.executable,'-c','import sys; print(repr(sys.stdin.read()))'],stdout=subprocess.PIPE,text=True)
print(p.communicate(timeout=3)[0].strip())
"""
        with (self.root/'launch-input.txt').open('w+') as source:
            source.write('BENIGN_LAUNCH_SENTINEL');source.seek(0)
            env=__import__('os').environ.copy();env['PYTHONPATH']=str(Path(engine.__file__).parent)
            result=subprocess.run([sys.executable,'-B','-c',launcher],stdin=source,env=env,capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),"''")

    def test_exported_prompt_accepts_only_exact_or_reversible_cli_encoding(self):
        text='只读检查这些叶子：["alpha", "beta"]'
        def data(value):return {'messages':[{'type':'user','text':value}]}
        self.assertEqual(engine.request_prompt_encoding(data(text),text),'raw')
        self.assertEqual(engine.request_prompt_encoding(data(json.dumps(text,ensure_ascii=False)),text),'json_string')
        self.assertIsNone(engine.request_prompt_encoding(data(text+'\nBENIGN_LAUNCH_SENTINEL'),text))
        self.assertIsNone(engine.request_prompt_encoding(data(json.dumps(text+'\nEXTRA')),text))
        self.assertIsNone(engine.request_prompt_encoding({'messages':data(text)['messages']*2},text))

    def test_multiline_cli_quoting_keeps_backslashes_and_rejects_extra_text(self):
        text='修复公开资料\n{"note": "中文、引号'+chr(92)+'n、$value、'+chr(96)+'sample'+chr(96)+'"}'
        encoded='"'+text.replace('"',chr(92)+'"')+'"'
        def data(value):return {'messages':[{'type':'user','text':value}]}
        self.assertEqual(engine.request_prompt_encoding(data(encoded),text),'cli_quoted')
        self.assertIsNone(engine.request_prompt_encoding(data(encoded+'\nEXTRA'),text))
        self.assertIsNone(engine.request_prompt_encoding(data('"'+(text+'\nEXTRA').replace('"',chr(92)+'"')+'"'),text))
        self.assertIsNone(engine.request_prompt_encoding(data(encoded.replace('中文','changed')),text))

    def test_error_event_releases_hung_process(self):
        path=self.root/'hung.jsonl'
        code="import json,time; print(json.dumps({'type':'error','error':{'status':503,'message':'Endpoint unavailable'}}),flush=True); time.sleep(30)"
        with path.open('w') as output:
            process=engine.spawn_tracked([sys.executable,'-B','-c',code],stdout=output,stderr=subprocess.STDOUT)
            started=time.monotonic()
            try:engine.wait_for_cli(process,path,5)
            finally:
                engine.terminate_processes([process]);engine.ACTIVE_PROCESSES.pop(process.pid,None)
        self.assertIsNotNone(process.poll())
        self.assertLess(time.monotonic()-started,3)

    def test_review_source_index_uses_batch_relative_existing_paths(self):
        project=self.root/'project';content=b'Public product workflow evidence';digest=hashlib.sha256(content).hexdigest()
        source=project/'data/collections/sources'/(digest+'.txt');source.parent.mkdir(parents=True);source.write_bytes(content)
        entry={'id':'public-app','sources':[{'snapshot_path':'sources/'+digest+'.txt','sha256':digest,'url':'https://example.org/docs','kind':'documentation'}]}
        engine.save(project/'data/collections/batch.json',{'entries':[entry]})
        continuation.prepare_review_sources(project)
        index=json.loads((project/'REVIEW_SOURCES.json').read_text())
        self.assertEqual(index['sources'][0]['path'],'data/collections/sources/'+digest+'.txt')
        self.assertTrue((project/index['sources'][0]['path']).is_file())
        source.write_text('changed')
        with self.assertRaises(AssertionError):continuation.prepare_review_sources(project)

    def test_old_ready_draft_gets_only_fresh_review_and_keeps_history(self):
        unit={'unit':1,'phase':'repair','parent':1,'slugs':['alpha','beta']}
        part=self.root/'part-001';project=part/'project';(project/'.git').mkdir(parents=True)
        engine.save(project/'issues.json',{'findings':['old issue already repaired']})
        checked={'batch_sha256':'a','research_sha256':'b','input_sha256':'c'}
        engine.save(part/'validation-1.json',checked)
        old={'status':'awaiting_final_review',**checked}
        engine.save(part/'state.json',old);engine.save(project/'review.json',report())
        engine.save(project/'data/collections/batch.json',{'entries':[]})
        def review(*args):
            self.assertEqual(args[3],'review')
            engine.save(project/'review.json',report())
            return {'role':'review','session':'new-independent-session','prompt_verified':True}
        with patch.object(continuation,'ROOT',self.root),patch.object(continuation,'UNITS',[unit]),patch.object(continuation,'prepare',return_value=part),patch.object(continuation,'summary'),patch.object(continuation,'validate',return_value=checked),patch.object(engine,'turn',side_effect=review) as run:
            state=continuation.run_unit(1,self.root/'common')
            self.assertEqual(run.call_count,1)
            self.assertEqual(state['review_protocol'],engine.REVIEW_PROTOCOL)
            self.assertEqual(state['status'],'awaiting_final_review')
            self.assertEqual(json.loads(next((part/'state-history').glob('*.json')).read_text()),old)
            self.assertEqual(json.loads(next((part/'review-history').glob('*.json')).read_text()),report())
            run.reset_mock()
            self.assertEqual(continuation.run_unit(1,self.root/'common'),state)
            run.assert_not_called()


if __name__=='__main__':unittest.main()
