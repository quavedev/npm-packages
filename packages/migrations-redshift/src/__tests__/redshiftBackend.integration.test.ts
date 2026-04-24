import { runBackendContract } from '@quave/migrations/testing';
import { RedshiftBackend, RedshiftBackendOptions } from '../redshiftBackend';

const hasCreds =
  !!process.env['REDSHIFT_DATABASE'] &&
  (!!process.env['REDSHIFT_WORKGROUP'] ||
    (!!process.env['REDSHIFT_CLUSTER'] && !!process.env['REDSHIFT_DB_USER']));

const describeOrSkip = hasCreds ? describe : describe.skip;

describeOrSkip('Redshift real-cluster integration', () => {
  const buildOpts = (): RedshiftBackendOptions => {
    const opts: RedshiftBackendOptions = {
      database: process.env['REDSHIFT_DATABASE']!,
      schemaName: process.env['REDSHIFT_SCHEMA'] ?? 'public',
      tableName: process.env['REDSHIFT_TABLE'] ?? 'migrations_control_test',
    };
    if (process.env['REDSHIFT_WORKGROUP']) {
      opts.workgroupName = process.env['REDSHIFT_WORKGROUP'];
    }
    if (process.env['REDSHIFT_CLUSTER']) {
      opts.clusterIdentifier = process.env['REDSHIFT_CLUSTER'];
    }
    if (process.env['REDSHIFT_DB_USER']) {
      opts.dbUser = process.env['REDSHIFT_DB_USER'];
    }
    if (process.env['REDSHIFT_SECRET_ARN']) {
      opts.secretArn = process.env['REDSHIFT_SECRET_ARN'];
    }
    if (process.env['AWS_REGION']) {
      opts.region = process.env['AWS_REGION'];
    }
    return opts;
  };

  runBackendContract('RedshiftBackend (real cluster)', () => new RedshiftBackend(buildOpts()));

  it('exactly one of N concurrent tryLock calls wins (distributed lock)', async () => {
    const opts = buildOpts();
    const backends = Array.from({ length: 5 }, () => new RedshiftBackend(opts));
    await backends[0]!.init();
    await backends[0]!.reset();
    await Promise.all(backends.map((b) => b.init()));

    const results = await Promise.all(backends.map((b) => b.tryLock()));
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);

    for (const b of backends) {
      await b.unlock();
    }
  }, 60_000);
});
