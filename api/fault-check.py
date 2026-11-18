"""Mutation checks run only in a disposable public-source copy, never in the shared checkout."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
scratch = root / '_scratch/m3/backend/faults'
scratch.mkdir(parents=True, exist_ok=True)
mutations = [
    ('cover-alias-policy', 'api/common.go', '\t\tsetCoverResponseHeaders(c.Writer)\n', '', './api', 'TestCoverServesRealSVGWithInertNavigationPolicy'),
    ('opds-opaque-links', 'api/opds-routes.go', 'fmt.Sprintf("/api/opds/documents/%s/file", url.PathEscape(doc.ID))', 'fmt.Sprintf("/api/opds/documents/%s/file", doc.ID)', './api', 'TestOPDSPublishedOpaqueLinksReachOriginalResources'),
    ('registration-work-status', 'api/auth.go', '\t\treturn failure.Status\n\t}\n\treturn 0', '\t\treturn 0\n\t}\n\treturn 0', './api', 'TestLegacyCredentialOverloadRetryAfter'),
    ('legacy-retry-after', 'api/response-policy.go', 'status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable', 'false', './api', 'TestLegacyCredentialOverloadRetryAfter'),
    ('zero-duration-statistics', 'database/document_user_statistics.sql', '/ (SUM(ga.total_time_seconds) / 60.0), 0.0) AS total_wpm,', '/ (SUM(ga.total_time_seconds) / 60.0), NULL) AS total_wpm,', './api', 'TestZeroDurationActivityPreservesCreditAndStatistics'),
    ('opaque-path-plus', 'api/web-validation.go', 'url.PathUnescape(c.Params[i].Value)', 'url.QueryUnescape(c.Params[i].Value)', './api', 'TestOpaqueDocumentIDsSurvivePathEscaping'),
    ('historical-owner', 'database/migrations/20261126000000_react_upgrade.go', ' JOIN documents d ON d.id=p.document_id AND d.deleted=0\n ) WHERE rank=1', ' JOIN documents d ON d.id=p.document_id AND d.deleted=0\n JOIN devices v ON v.id=p.device_id AND v.user_id=p.user_id\n ) WHERE rank=1', './api', 'TestRealKOHTTPDeterministicHistoricalTie'),
    ('auth-revocation', 'api/auth.go', 'current.AuthHash == nil || *current.AuthHash != hash', 'false', './api', 'TestWebIdentityCSRFAndRevocation'),
    ('statistics-head', 'database/document_user_statistics.sql', '            SELECT head.fraction\n            FROM reading_heads AS head\n            WHERE head.user_id = iga.user_id AND head.document_id = iga.document_id', '            SELECT NULL', './api', 'TestStatisticsFollowSharedBackwardHeadWithoutRewritingCredit'),
    ('legacy-auth-rate', 'api/auth.go', '\trefund()\n\tc.Set("Authorization", *auth)', '\tc.Set("Authorization", *auth)', './api', 'TestSuccessfulLegacyHeaderAuthDoesNotThrottleSynchronization'),
    ('ssr-progress-units', 'api/app-routes.go', 'percentage = math.Round(*progress.Fraction*10000) / 100', 'percentage = *progress.Fraction', './api', 'TestSSRReaderProgressUsesHeadAndPreservesDisplayUnits'),
    ('cas', 'reading/reading.go', 'base != nil && head.Revision != *base', 'false', './api', 'TestRealKOAndWebSharedHead'),
    ('signed-zero', 'reading/reading.go', 'if f == 0 {\n\t\treturn 0\n\t}', 'if f == 0 {\n\t\treturn f\n\t}', './api', 'TestDurableReceiptsNormalizationAndConflicts'),
    ('ko-fraction', 'api/ko-routes.go', '"percentage": progress.Fraction', '"percentage": 0.99', './api', 'TestKOSyncTimestampUsesPersistedAcceptedHead'),
    ('receipt-kind', 'api/web-routes.go', 'Kind: ReceiptKind(out.Kind)', 'Kind: Progress', './api', 'TestDurableReceiptsNormalizationAndConflicts'),
    ('origin', 'api/web-validation.go', 'c.GetHeader("Origin") != api.cfg.PublicOrigin', 'false', './api', 'TestWebIdentityCSRFAndRevocation'),
    ('duplicate-json', 'api/web-validation.go', '!json.Valid(body) || uniqueJSON(body) != nil', '!json.Valid(body)', './api', 'TestWebJSONClosedValidationAndCancellation'),
    ('historical-tie', 'database/migrations/20261126000000_react_upgrade.go', 'p.device_id ASC', 'p.device_id DESC', './database', 'TestReadingAdditiveMigrationPreservesHistoricalRowsAndOrphans'),
    ('receipt-rollback', 'reading/reading.go', 'if err != nil {\n\t\treturn Decision{}, err\n\t}\n\tif err = tx.Commit();', 'if err != nil {\n\t\treturn out, tx.Commit()\n\t}\n\tif err = tx.Commit();', './api', 'TestReadingAtomicRollbackAndConcurrentCAS'),
    ('replay', 'reading/reading.go', '\t\treturn out, nil\n\t}\n\tif !errors.Is(err, sql.ErrNoRows)', '\t\treturn Decision{}, fail(500,"storage_error")\n\t}\n\tif !errors.Is(err, sql.ErrNoRows)', './api', 'TestDurableReceiptsNormalizationAndConflicts'),
    ('worker-deadline', 'server/server.go', '\tfor {\n\t\tselect {\n\t\tcase <-ticker.C:\n\t\t\tctx, cancel := context.WithTimeout(s.workerCtx, timeout)', '\tctx, cancel := context.WithTimeout(s.workerCtx, timeout)\n\tdefer cancel()\n\tfor {\n\t\tselect {\n\t\tcase <-ticker.C:', './server', 'TestTaskContextStartsAtEachTickAndShutdownDrains'),
]
with tempfile.TemporaryDirectory(prefix='source.', dir=scratch) as directory:
    work = Path(directory)
    for name in ('go.mod', 'go.sum'):
        shutil.copy2(root / name, work / name)
    for name in ('api', 'database', 'reading', 'config', 'server', 'metadata', 'opds', 'search', 'graph', 'pkg', 'utils', 'assets', 'templates', '_test_files'):
        shutil.copytree(root / name, work / name, ignore=shutil.ignore_patterns('node_modules', 'app', '__pycache__'))
    (work / 'web/src/api').mkdir(parents=True)
    shutil.copy2(root / 'web/package.json', work / 'web/package.json')
    shutil.copy2(root / 'web/src/api/schema.gen.ts', work / 'web/src/api/schema.gen.ts')
    (work / 'web/node_modules').symlink_to(root / 'web/node_modules', target_is_directory=True)
    temporary = scratch.parent / 'tmp'
    temporary.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'GOWORK': 'off', 'TMPDIR': str(temporary)}
    baseline = subprocess.run(['go', 'test', '-mod=readonly', '-count=1', '-timeout=60s', './api', './database', './server'], cwd=work, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
    (scratch / 'baseline.log').write_text(baseline.stdout)
    if baseline.returncode:
        raise SystemExit('public-source baseline failed; see baseline.log')
    for name, relative, original, replacement, package, test in mutations:
        path = work / relative
        source = path.read_text()
        if source.count(original) != 1:
            raise SystemExit(f'{name}: mutation anchor is not unique')
        try:
            path.write_text(source.replace(original, replacement))
            result = subprocess.run(['go', 'test', '-mod=readonly', '-count=1', '-timeout=30s', package, '-run', f'^{test}$'], cwd=work, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
            (scratch / f'{name}.log').write_text(result.stdout)
            if not result.returncode or f'--- FAIL: {test}' not in result.stdout or '[build failed]' in result.stdout:
                raise SystemExit(f'{name}: did not produce the intended behavioral failure')
            print(f'{name}: detected by {test}')
            if name == 'cover-alias-policy' and os.environ.get('ANTHOLUME_COVER_BROWSER_FAULTS') == '1':
                result = subprocess.run(['go', 'test', '-mod=readonly', '-count=1', '-timeout=120s', './api', '-run', '^TestCoverBrowserIsolation$', '-v'], cwd=work, env={**env, 'ANTHOLUME_COVER_BROWSER': '1'}, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
                (scratch / 'cover-alias-browser.log').write_text(result.stdout)
                if not result.returncode or '--- FAIL: TestCoverBrowserIsolation' not in result.stdout or '[build failed]' in result.stdout:
                    raise SystemExit('cover alias mutation did not fail actual Chromium isolation')
                print('cover-alias-policy: also detected by actual Chromium')
        finally:
            path.write_text(source)
    baseline = subprocess.run(['bash', 'api/check-generation.sh'], cwd=work, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    (scratch / 'generation-baseline.log').write_text(baseline.stdout)
    if baseline.returncode:
        raise SystemExit('generation baseline failed')
    schema = work / 'api/openapi.yaml'
    source = schema.read_text()
    anchor = '        demo_mode: {type: boolean}'
    assert source.count(anchor) == 1
    schema.write_text(source.replace(anchor, anchor + '\n        mutation_probe: {type: boolean}'))
    result = subprocess.run(['bash', 'api/check-generation.sh'], cwd=work, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    (scratch / 'generation-drift.log').write_text(result.stdout)
    if not result.returncode or not all(f'generated artifact drift: {path}' in result.stdout for path in ('api/contract.gen.go', 'web/src/api/schema.gen.ts')):
        raise SystemExit('generation drift did not detect both artifacts')
    print('generation-drift: Go and TypeScript changes both detected')
print(f'{len(mutations)} behavioral mutations plus generation drift detected; shared source unchanged')
