import copy
import json
import tempfile
import unittest
from pathlib import Path
from gate_eval import ROOT, read_jsonl, lint, template, evaluate, input_hash

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.cases=read_jsonl(ROOT/'candidate/cases.jsonl')
        self.rubrics=read_jsonl(ROOT/'reviewer/rubrics.jsonl')
        self.results=template(self.cases,self.rubrics)

    def fill_synthetic_records(self):
        # Fixture for the validator ONLY, never used as model/product output.
        for result,rubric in zip(self.results,self.rubrics):
            result.update(commit='SYNTHETIC-NOT-APP',decision=rubric['allowed_decisions'][0],
                          final_text='合成工具测试文本，不是方坤回答。',trace_refs=['synthetic://test'],
                          run_scope='SYNTHETIC_HARNESS_TEST')
            for q in result['checks']:
                q.update(status='PASS',reviewer='synthetic-test',evidence='synthetic://assertion')
            if rubric['professional_required']:
                result['professional_review']=dict(status='REVIEWED',reviewer='synthetic-test',
                                                   evidence='synthetic://not-real-professional-review')

    def report(self):
        return evaluate(self.cases,self.rubrics,self.results)

    def test_suite_contract(self):
        self.assertEqual(lint(self.cases,self.rubrics),dict(cases=50,criteria=150,professional_required=7))

    def test_unrun_never_passes(self):
        self.assertEqual(self.report()['counts'],dict(PASS=0,FAIL=0,PENDING=50))

    def test_missing_results(self):
        self.results=[]
        self.assertEqual(self.report()['counts']['PENDING'],50)

    def test_duplicate_result_is_rejected(self):
        self.results.append(copy.deepcopy(self.results[0]))
        with self.assertRaises(ValueError): self.report()

    def test_unknown_result_is_rejected(self):
        self.results[0]['case_id']='UNKNOWN'
        with self.assertRaises(ValueError): self.report()

    def test_hash_mismatch_blocks(self):
        self.fill_synthetic_records();self.results[0]['input_hash']='wrong'
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_complete_records_do_not_certify_app(self):
        self.fill_synthetic_records()
        r=self.report()
        self.assertTrue(r['records_complete'])
        self.assertEqual(r['actual_app_acceptance'],'NOT_ESTABLISHED_BY_THIS_TOOL')
        self.assertEqual(r['run_scopes'],['SYNTHETIC_HARNESS_TEST'])

    def test_missing_criterion_blocks(self):
        self.fill_synthetic_records(); self.results[0]['checks'].pop()
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_pass_without_evidence_blocks(self):
        self.fill_synthetic_records(); self.results[0]['checks'][0]['evidence']=''
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_explicit_fail_not_hidden_by_pending(self):
        self.results[0]['checks'][0]['status']='FAIL'
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_professional_pending_is_not_pass(self):
        self.fill_synthetic_records()
        self.results[3]['professional_review']['status']='PENDING'
        self.assertEqual(self.report()['counts']['PENDING'],1)

    def test_wrong_professional_bypass(self):
        self.fill_synthetic_records()
        self.results[3]['professional_review']['status']='NOT_REQUIRED'
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_empty_final_blocks(self):
        self.fill_synthetic_records();self.results[0]['final_text']=' '
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_wrong_decision_blocks(self):
        self.fill_synthetic_records();self.results[10]['decision']='VALIDATED'
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_retry_usage_and_unknown_not_zero(self):
        self.fill_synthetic_records()
        self.results[0]['attempts']=[dict(usage=dict(input=100,output=20)),dict(usage=dict(input=30,output=10)),dict(usage=None)]
        self.assertEqual(self.report()['usage'],dict(attempts=3,known_tokens=160,unknown_attempts=1,exact_total_known=False))

    def test_negative_usage_blocks(self):
        self.fill_synthetic_records();self.results[0]['attempts']=[dict(usage=dict(input=-1,output=10))]
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_duplicate_json_keys_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'case.jsonl';p.write_text('{"case_id":"a","case_id":"b"}\n')
            with self.assertRaises(ValueError):read_jsonl(p)

    def test_changed_fixture_hash_detected(self):
        self.cases[0]['question']='changed'
        with self.assertRaises(ValueError):lint(self.cases,self.rubrics)

    def test_no_usage_is_not_known_zero(self):
        self.assertFalse(self.report()['usage']['exact_total_known'])

    def test_unknown_check_not_accepted(self):
        self.fill_synthetic_records();self.results[0]['checks'][0]['status']='AUTO_PASS'
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_mixed_commits_rejected(self):
        self.fill_synthetic_records();self.results[0]['commit']='other-version'
        with self.assertRaises(ValueError):self.report()

    def test_live_without_receipts_rejected(self):
        self.fill_synthetic_records();self.results[0]['run_scope']='FROZEN_LIVE'
        self.assertEqual(self.report()['counts']['FAIL'],1)

    def test_duplicate_live_attempts_rejected(self):
        self.fill_synthetic_records();self.results[0]['run_scope']='FROZEN_LIVE'
        a=dict(attempt_id='call1',receipt_ref='synthetic://receipt',usage=None)
        self.results[0]['attempts']=[a,copy.deepcopy(a)]
        self.assertEqual(self.report()['counts']['FAIL'],1)

if __name__=='__main__':
    unittest.main()

