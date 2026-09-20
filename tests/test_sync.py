import json
import io
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sync


def submission(sid, verdict='OK', members=None, team_id=None, at=None):
    author = {'members': members or [{'handle': 'Lucius7'}]}
    if team_id:
        author['teamId'] = team_id
    return {'id': sid, 'verdict': verdict, 'creationTimeSeconds': at or sid,
            'problem': {'contestId': 103426, 'index': 'B', 'name': 'Permutations'}, 'author': author}


class SyncTest(unittest.TestCase):
    def test_github_auth_is_never_sent_to_codeforces(self):
        with patch.dict('os.environ', {'GITHUB_TOKEN': 'test-workflow-token'}):
            with patch('sync.urllib.request.urlopen', side_effect=lambda *args, **kwargs: io.StringIO('{}')) as request:
                sync.json_request('https://api.github.com/repos/Yawn-Sean/Daily_CF_Problems/commits/main')
                self.assertEqual(request.call_args.args[0].get_header('Authorization'), 'Bearer test-workflow-token')
                sync.json_request('https://codeforces.com/api/user.status?handle=Lucius7')
                self.assertIsNone(request.call_args.args[0].get_header('Authorization'))

    def test_markdown_keeps_absolute_value_pipes_and_escaped_pipes(self):
        rows = list(sync.table_rows('| *1700 | [GYM103426B](https://codeforces.com/gym/103426/problem/B) | Try $|x|$ and \\|y\\|. | [Editorial](https://example.com) |'))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['hint'], 'Try $|x|$ and |y|.')
        self.assertTrue(rows[0]['estimated'])
        self.assertEqual(sync.problem_key('https://codeforces.com/contest/123/problem/B1'), 'cf:123:B1')

    def test_catalog_checks_editorial_exists_and_matches_case_insensitive_handle(self):
        files = {
            'daily_problems/2026/09/0912/problems.md': '| *1000 | [GYM103426B](https://codeforces.com/gym/103426/problem/B) | Place numbers. |',
            'daily_problems/2026/09/0912/solution/cf103426b.md': '',
            'daily_problems/2026/09/0912/personal_submission/cf103426b_lucius7.cpp': '',
            'categories/constructive.md': '| *1000 | [GYM103426B](https://codeforces.com/gym/103426/problem/B) | hint |',
        }
        task = sync.make_catalog(files, 'abcdef')['tasks'][0]
        self.assertIn('/blob/abcdef/', task['editorial'])
        self.assertEqual(len(task['codeUrls']), 1)
        self.assertEqual(task['categories'], ['constructive'])
        del files['daily_problems/2026/09/0912/solution/cf103426b.md']
        self.assertIsNone(sync.make_catalog(files, 'abcdef')['tasks'][0]['editorial'])

    def test_team_acceptance_and_later_failed_submission_preserve_first_solo_ac(self):
        rows = [submission(4, 'WRONG_ANSWER'), submission(3), submission(2), submission(1, team_id=5)]
        record = sync.make_progress(rows)['problems']['cf:103426:B']
        self.assertEqual(record['firstAccepted']['id'], 2)
        self.assertEqual(record['teamAccepted']['id'], 1)
        self.assertEqual(record['latest']['verdict'], 'WRONG_ANSWER')
        self.assertEqual(record['soloAttempts'], 3)

    def test_excludes_another_handle_and_team_ac_is_never_solo_ac(self):
        snapshot = sync.make_progress([submission(1, members=[{'handle': 'elsewhere'}]), submission(2, members=[{'handle': 'Lucius7'}, {'handle': 'teammate'}])])
        record = snapshot['problems']['cf:103426:B']
        self.assertIsNone(record['firstAccepted'])
        self.assertEqual(record['attempts'], 1)

    def test_failure_retains_old_success_timestamp_and_accepted_records(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            old = sync.make_progress([submission(1)], '2026-09-12T00:00:00Z')
            sync.atomic_json(path, old)
            def fail():
                raise RuntimeError('offline')
            current, ok = sync.refresh_progress(path, fetch=fail)
            self.assertFalse(ok)
            self.assertEqual(current['updatedAt'], old['updatedAt'])
            self.assertEqual(current['problems'], old['problems'])
            self.assertEqual(json.loads(path.read_text())['error'], 'offline')

    def test_failure_without_snapshot_is_unknown_not_unattempted(self):
        with tempfile.TemporaryDirectory() as directory:
            def fail():
                raise RuntimeError('offline')
            current, ok = sync.refresh_progress(Path(directory) / 'progress.json', fetch=fail)
            self.assertFalse(ok)
            self.assertFalse(current['publicHistoryComplete'])
            self.assertIsNone(current['updatedAt'])

    def test_paginates_and_deduplicates_overlapping_submission_pages(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return {'status': 'OK', 'result': [{'id': i} for i in range(10000)] if len(calls) == 1 else [{'id': 9999}, {'id': 10000}]}
        rows = sync.fetch_submissions(request=fetch, pause=lambda _: None)
        self.assertEqual(len(rows), 10001)
        self.assertIn('from=10001', calls[1])

    def test_real_snapshot_links_and_keys_are_consistent(self):
        catalog = json.loads((sync.ROOT / 'public/data/calendar.json').read_text())
        self.assertEqual(len(catalog['tasks']), len({task['key'] for task in catalog['tasks']}))
        for task in catalog['tasks']:
            self.assertEqual(sync.problem_key(task['url']), task['id'])
            self.assertGreater(task['difficulty'], 0)
            self.assertTrue(task['hint'])
            self.assertIn(task['date'].replace('-', '/')[:7], task['sourceUrl'])


if __name__ == '__main__':
    unittest.main()
